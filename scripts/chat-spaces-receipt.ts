import { constants } from "node:fs";
import { link, mkdir, mkdtemp, open, rmdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import {
  chatSpacesReceiptSchema,
  type ChatSpacesReceipt,
} from "@/lib/seed/chat-spaces-receipt";
import { SeedError } from "@/lib/seed/errors";

export function chatSpacesReceiptFilename(targetHash: string) {
  if (!/^[a-f0-9]{64}$/u.test(targetHash))
    throw new SeedError("스페이스 적용 표식의 대상 식별자가 올바르지 않아요.");
  return `chat-spaces-v1-${targetHash}.json`;
}

async function syncDirectory(directory: string) {
  const file = await open(directory, "r");
  try {
    await file.sync();
  } finally {
    await file.close();
  }
}
function missing(error: unknown) {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

export function createChatSpacesReceiptStore(
  directory = resolve(process.cwd(), ".floor-local", "seed-receipts"),
) {
  return {
    async readChatSpacesReceipt(
      targetHash: string,
    ): Promise<ChatSpacesReceipt | null> {
      const target = join(directory, chatSpacesReceiptFilename(targetHash));
      try {
        const file = await open(
          target,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        ).catch((error: unknown) => {
          if (missing(error)) return null;
          throw error;
        });
        if (!file) return null;
        try {
          const stat = await file.stat();
          if (!stat.isFile() || stat.size > 64 * 1024) throw new Error();
          const receipt = chatSpacesReceiptSchema.parse(
            JSON.parse(await file.readFile("utf8")),
          );
          if (receipt.targetHash !== targetHash) throw new Error();
          return receipt;
        } finally {
          await file.close();
        }
      } catch {
        throw new SeedError(
          "스페이스 적용 표식을 읽지 못했어요. 표식을 고치거나 지우지 말고 적용 상태를 확인해 주세요.",
        );
      }
    },
    async writeChatSpacesReceipt(input: ChatSpacesReceipt): Promise<void> {
      const receipt = chatSpacesReceiptSchema.parse(input);
      const target = join(
        directory,
        chatSpacesReceiptFilename(receipt.targetHash),
      );
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporaryDirectory = await mkdtemp(
        join(directory, ".chat-spaces-"),
      );
      const temporary = join(temporaryDirectory, "receipt.json");
      try {
        const file = await open(temporary, "wx", 0o600);
        try {
          await file.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
          await file.sync();
        } finally {
          await file.close();
        }
        // 커밋 뒤 기록은 배타적으로 공개한다. 오류가 나면 재시도 대신 수동 확인한다.
        await link(temporary, target);
        await syncDirectory(directory);
      } finally {
        await unlink(temporary).catch(() => {});
        await rmdir(temporaryDirectory).catch(() => {});
      }
    },
    async archiveChatSpacesReceipt(targetHash: string): Promise<string | null> {
      const filename = chatSpacesReceiptFilename(targetHash);
      const target = join(directory, filename);
      const file = await open(
        target,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      ).catch((error: unknown) => {
        if (missing(error)) return null;
        throw error;
      });
      if (!file) return null;
      try {
        const original = await file.stat();
        if (!original.isFile()) throw new Error("Invalid receipt");
        const archived = `${filename}.${randomUUID()}.reset-archive`;
        await link(target, join(directory, archived));
        const current = await open(
          target,
          constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
        );
        try {
          const stat = await current.stat();
          if (stat.ino !== original.ino || stat.dev !== original.dev)
            throw new Error("Receipt changed");
        } finally {
          await current.close();
        }
        await unlink(target);
        await syncDirectory(directory);
        return archived;
      } finally {
        await file.close();
      }
    },
  };
}
