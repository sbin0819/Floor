import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import {
  chatSpacesReceiptSchema,
  chatSpacesTarget,
  validateChatSpacesOptions,
  type ChatSpacesReceipt,
} from "@/lib/seed/chat-spaces-receipt";
import {
  chatSpacesReceiptFilename,
  createChatSpacesReceiptStore,
} from "@/scripts/chat-spaces-receipt";

const target = chatSpacesTarget(
  "postgresql://private:secret@EXAMPLE.test/Floor?sslmode=require",
);
const receipt: ChatSpacesReceipt = {
  version: 1,
  mode: "chat-spaces",
  targetHash: target.targetHash,
  manifestHash: "a".repeat(64),
  bundleHash: "b".repeat(64),
  appliedAt: "2026-10-09T00:00:00.000Z",
  lounges: [
    {
      branchId: "15eeb72a-6e7f-57ca-a905-d8797f988992",
      spaceId: "8ac46e85-57e5-55cf-aa23-1608a7664b1d",
      roomId: "04b9ed91-94b2-5940-97bb-c67bca0132e7",
    },
  ],
};
const directories: string[] = [];
const execute = promisify(execFile);
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "floor-chat-receipts-"));
  directories.push(directory);
  return {
    directory,
    store: createChatSpacesReceiptStore(directory),
    path: join(directory, chatSpacesReceiptFilename(target.targetHash)),
  };
}
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

describe("chat-spaces target and commit receipt", () => {
  it("uses canonical host and decoded case-sensitive DB name, never credentials", () => {
    expect(target.hostname).toBe("example.test");
    expect(target.databaseName).toBe("Floor");
    expect(
      chatSpacesTarget("postgres://other:password@example.test/%46loor")
        .targetHash,
    ).toBe(target.targetHash);
    expect(
      chatSpacesTarget("postgres://example.test/floor").targetHash,
    ).not.toBe(target.targetHash);
    expect(chatSpacesTarget("postgres://other.test/Floor").targetHash).not.toBe(
      target.targetHash,
    );
    expect(JSON.stringify(target)).not.toMatch(/private|secret|password/);
  });
  it.each([
    "postgres://host",
    "https://host/floor",
    "postgres://host/%00",
    "postgres://host/%FF",
    "postgres://host/%2546loor",
    "postgres://host/name%25literal",
    "postgres://host/%2525",
    "postgres://host/%2500",
    "postgres://host/floor?host=elsewhere",
    "postgres://host/floor?DATABASE=other",
    "postgres://host/floor?dbname=other",
    "postgres://host/floor?port=123",
    "postgres:///floor",
  ])("rejects ambiguous target %s safely", (url) => {
    expect(() => chatSpacesTarget(url)).toThrow("대상 호스트와 DB 이름");
  });
  it("validates strict shape, matching target and unique lounge anchors", () => {
    expect(validateChatSpacesOptions({ ...target, receipt })).toEqual(receipt);
    expect(validateChatSpacesOptions({ ...target, receipt: null })).toBeNull();
    expect(() =>
      validateChatSpacesOptions({ ...target, targetHash: "bad", receipt }),
    ).toThrow();
    expect(() =>
      validateChatSpacesOptions({
        ...target,
        receipt: { ...receipt, targetHash: "c".repeat(64) },
      }),
    ).toThrow();
    expect(() =>
      validateChatSpacesOptions({
        ...target,
        receipt: {
          ...receipt,
          lounges: [...receipt.lounges, ...receipt.lounges],
        },
      }),
    ).toThrow();
    expect(
      chatSpacesReceiptSchema.safeParse({ ...receipt, secret: "not-allowed" })
        .success,
    ).toBe(false);
    expect(() =>
      validateChatSpacesOptions({
        ...target,
        databaseName: "%46loor",
        receipt: null,
      }),
    ).toThrow();
  });
  it("publishes a complete private file and never overwrites an existing receipt", async () => {
    const { store, path, directory } = await fixture();
    expect(await store.readChatSpacesReceipt(target.targetHash)).toBeNull();
    await store.writeChatSpacesReceipt(receipt);
    expect(await store.readChatSpacesReceipt(target.targetHash)).toEqual(
      receipt,
    );
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const original = await readFile(path, "utf8");
    await expect(
      store.writeChatSpacesReceipt({ ...receipt, bundleHash: "d".repeat(64) }),
    ).rejects.toThrow();
    expect(await readFile(path, "utf8")).toBe(original);
    expect(await readdir(directory)).toEqual([
      chatSpacesReceiptFilename(target.targetHash),
    ]);
  });
  it("allows only one concurrent writer and leaves no temporary directories", async () => {
    const { store, directory } = await fixture();
    const results = await Promise.allSettled([
      store.writeChatSpacesReceipt(receipt),
      store.writeChatSpacesReceipt(receipt),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(await readdir(directory)).toEqual([
      chatSpacesReceiptFilename(target.targetHash),
    ]);
    expect(await store.readChatSpacesReceipt(target.targetHash)).toEqual(
      receipt,
    );
  });
  it.each(["json", "mismatch", "symlink", "oversized"])(
    "fails closed on %s without leaking contents",
    async (kind) => {
      const { store, path, directory } = await fixture();
      if (kind === "symlink") {
        const source = join(directory, "source.json");
        await writeFile(source, JSON.stringify(receipt));
        await symlink(source, path);
      } else
        await writeFile(
          path,
          kind === "json"
            ? "private-secret"
            : kind === "oversized"
              ? "x".repeat(65 * 1024)
              : JSON.stringify({ ...receipt, targetHash: "c".repeat(64) }),
        );
      await expect(
        store.readChatSpacesReceipt(target.targetHash),
      ).rejects.toThrow("표식을 읽지 못했어요");
    },
  );
  it("archives only the selected database receipt after an explicitly committed reset", async () => {
    const { store, directory } = await fixture();
    await store.writeChatSpacesReceipt(receipt);
    const other = {
      ...receipt,
      targetHash: chatSpacesTarget("postgres://example.test/Other").targetHash,
    };
    await store.writeChatSpacesReceipt(other);
    const archived = await store.archiveChatSpacesReceipt(target.targetHash);
    expect(archived).toMatch(/\.reset-archive$/);
    expect(
      JSON.parse(await readFile(join(directory, archived!), "utf8")),
    ).toEqual(receipt);
    expect(await store.readChatSpacesReceipt(target.targetHash)).toBeNull();
    expect(await store.readChatSpacesReceipt(other.targetHash)).toEqual(other);
    expect(await store.archiveChatSpacesReceipt(target.targetHash)).toBeNull();
  });

  it.each(["readChatSpacesReceipt", "archiveChatSpacesReceipt"] as const)(
    "rejects a FIFO promptly in %s without waiting for a writer",
    async (method) => {
      const { path, directory } = await fixture();
      await execute("mkfifo", [path]);
      // open이 다시 blocking으로 바뀌어도 자식만 중단해 전체 테스트 프로세스의 종료를 보장한다.
      const source = `
        import { createChatSpacesReceiptStore } from './scripts/chat-spaces-receipt.ts';
        try {
          await createChatSpacesReceiptStore(${JSON.stringify(directory)}).${method}(${JSON.stringify(target.targetHash)});
          process.exitCode = 1;
        } catch {
          process.stdout.write('rejected');
        }
      `;
      const result = await execute(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", source],
        { timeout: 3000 },
      );
      expect(result.stdout).toBe("rejected");
      expect(result.stderr).toBe("");
    },
  );
});
