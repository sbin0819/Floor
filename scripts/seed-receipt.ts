import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  rmdir,
  unlink,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import {
  parseBookingRound2Receipt,
  type BookingRound2Receipt,
} from "@/lib/seed/booking-round2-receipt";
import { SeedError } from "@/lib/seed/errors";

export function seedReceiptFilename(hostHash: string): string {
  if (!/^[a-f0-9]{64}$/u.test(hostHash))
    throw new SeedError(
      "예약 2차 적용 표식의 호스트 식별자가 올바르지 않아요.",
    );
  return `booking-round2-v1-${hostHash}.json`;
}

export function createSeedReceiptStore(
  directory = resolve(process.cwd(), ".floor-local", "seed-receipts"),
) {
  return {
    async readReceipt(hostHash: string): Promise<BookingRound2Receipt | null> {
      const target = join(directory, seedReceiptFilename(hostHash));
      try {
        const stat = await lstat(target).catch((error: unknown) => {
          if (
            error &&
            typeof error === "object" &&
            "code" in error &&
            error.code === "ENOENT"
          )
            return null;
          throw error;
        });
        if (!stat) return null;
        if (!stat.isFile() || stat.isSymbolicLink())
          throw new Error("Invalid receipt file");
        const receipt = parseBookingRound2Receipt(
          JSON.parse(await readFile(target, "utf8")),
        );
        if (receipt.hostHash !== hostHash)
          throw new Error("Receipt host mismatch");
        return receipt;
      } catch {
        throw new SeedError(
          "예약 2차 적용 표식을 읽지 못했어요. 표식을 고치거나 지우지 말고 적용 상태를 확인해 주세요.",
        );
      }
    },
    async writeReceipt(input: BookingRound2Receipt): Promise<void> {
      const receipt = parseBookingRound2Receipt(input);
      const target = join(directory, seedReceiptFilename(receipt.hostHash));
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporaryDirectory = await mkdtemp(
        join(directory, ".booking-round2-"),
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
        // 완성된 파일만 한 번에 공개하고 기존 표식은 절대로 덮어쓰지 않는다.
        await link(temporary, target);
      } finally {
        await unlink(temporary).catch(() => {});
        await rmdir(temporaryDirectory).catch(() => {});
      }
    },
    async archiveReceipt(hostHash: string): Promise<string | null> {
      const filename = seedReceiptFilename(hostHash);
      const target = join(directory, filename);
      const source = await lstat(target).catch((error: unknown) => {
        if (
          error &&
          typeof error === "object" &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return null;
        throw error;
      });
      if (!source) return null;
      if (!source.isFile() || source.isSymbolicLink())
        throw new SeedError("예약 2차 적용 표식이 일반 파일이 아니에요.");

      const archivedFilename = `${filename}.${randomUUID()}.reset-archive`;
      // rename은 기존 파일을 덮어쓸 수 있어, 배타적인 링크 생성 후 원래 이름만 지운다.
      await link(target, join(directory, archivedFilename));
      const current = await lstat(target);
      if (current.ino !== source.ino || current.dev !== source.dev)
        throw new SeedError(
          "보관 중 예약 2차 적용 표식이 바뀌었어요. 원본과 보관본을 확인해 주세요.",
        );
      await unlink(target);
      return archivedFilename;
    },
  };
}
