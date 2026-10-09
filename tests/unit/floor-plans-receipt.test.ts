import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  floorPlansTarget,
  hashFloorPlansValue,
  validateFloorPlansOptions,
  type FloorPlansReceipt,
} from "@/lib/seed/floor-plans-receipt";
import {
  createFloorPlansReceiptStore,
  floorPlansReceiptFilename,
} from "@/scripts/floor-plans-receipt";

const targetHash = "a".repeat(64);
const receipt: FloorPlansReceipt = {
  version: 1,
  mode: "floor-plans",
  targetHash,
  manifestHash: "b".repeat(64),
  appliedAt: "2026-10-12T03:00:00.000Z",
  added: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      floorId: "00000000-0000-4000-8000-000000000002",
      createdBy: "00000000-0000-4000-8000-000000000003",
    },
  ],
  skippedFloorIds: ["00000000-0000-4000-8000-000000000004"],
};
let directory: string;
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "floor-plans-receipt-test-"));
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("private floor plan completion receipts", () => {
  it("binds host and case-sensitive database identity without credentials", () => {
    const value = floorPlansTarget(
      "postgresql://private:secret@DB.EXAMPLE.TEST:5432/Floor?sslmode=require",
    );
    expect(value).toEqual({
      hostname: "db.example.test",
      databaseName: "Floor",
      targetHash: hashFloorPlansValue(["db.example.test", "Floor"]),
    });
    expect(
      floorPlansTarget("postgresql://other:pass@db.example.test/floor")
        .targetHash,
    ).not.toBe(value.targetHash);
  });
  it.each([
    "postgresql://user:secret@host/db?host=other",
    "postgresql://host/db?DATABASE=other",
    "postgresql://host/%252Fother",
    "postgresql://host/",
    "https://host/db",
  ])("rejects an ambiguous target without exposing its URL", (url) => {
    expect(() => floorPlansTarget(url)).toThrow("대상 호스트와 DB 이름");
    try {
      floorPlansTarget(url);
    } catch (error) {
      expect(String(error)).not.toContain(url);
    }
  });
  it("writes atomically once with private permissions and reads only the selected target", async () => {
    const store = createFloorPlansReceiptStore(directory);
    expect(await store.readFloorPlansReceipt(targetHash)).toBeNull();
    await store.writeFloorPlansReceipt(receipt);
    expect(await store.readFloorPlansReceipt(targetHash)).toEqual(receipt);
    expect(
      (await stat(join(directory, floorPlansReceiptFilename(targetHash))))
        .mode & 0o777,
    ).toBe(0o600);
    await expect(
      store.writeFloorPlansReceipt({
        ...receipt,
        manifestHash: "c".repeat(64),
      }),
    ).rejects.toThrow();
    expect(await store.readFloorPlansReceipt(targetHash)).toEqual(receipt);
    expect(await readdir(directory)).toEqual([
      floorPlansReceiptFilename(targetHash),
    ]);
  });
  it("allows only one of two competing completion writes", async () => {
    const store = createFloorPlansReceiptStore(directory);
    const result = await Promise.allSettled([
      store.writeFloorPlansReceipt(receipt),
      store.writeFloorPlansReceipt(receipt),
    ]);
    expect(result.filter(({ status }) => status === "fulfilled")).toHaveLength(
      1,
    );
    expect(await store.readFloorPlansReceipt(targetHash)).toEqual(receipt);
  });
  it.each([
    "json",
    "extra",
    "target",
    "oversize",
    "directory",
    "symlink",
    "fifo",
  ])(
    "fails closed for %s instead of treating it as an absent receipt",
    async (kind) => {
      const path = join(directory, floorPlansReceiptFilename(targetHash));
      if (kind === "json") await writeFile(path, "private invalid data");
      if (kind === "extra")
        await writeFile(path, JSON.stringify({ ...receipt, private: true }));
      if (kind === "target")
        await writeFile(
          path,
          JSON.stringify({ ...receipt, targetHash: "c".repeat(64) }),
        );
      if (kind === "oversize") await writeFile(path, "x".repeat(64 * 1024 + 1));
      if (kind === "directory") await mkdir(path);
      if (kind === "symlink") {
        await writeFile(join(directory, "other"), JSON.stringify(receipt));
        await symlink(join(directory, "other"), path);
      }
      if (kind === "fifo") {
        expect(spawnSync("mkfifo", [path]).status).toBe(0);
        const source = `import { createFloorPlansReceiptStore } from './scripts/floor-plans-receipt.ts';
        try { await createFloorPlansReceiptStore(${JSON.stringify(directory)}).readFloorPlansReceipt(${JSON.stringify(targetHash)}); process.exitCode = 1; }
        catch { process.stdout.write('rejected'); }`;
        const result = spawnSync(
          process.execPath,
          ["--import", "tsx", "--input-type=module", "-e", source],
          { timeout: 3000, encoding: "utf8" },
        );
        expect(result.status).toBe(0);
        expect(result.stdout).toBe("rejected");
        return;
      }
      await expect(
        createFloorPlansReceiptStore(directory).readFloorPlansReceipt(
          targetHash,
        ),
      ).rejects.toThrow("평면도 적용 표식을 읽지 못했어요");
    },
  );
  it("archives without rewriting or parsing bytes, and does not disturb other targets", async () => {
    const store = createFloorPlansReceiptStore(directory);
    await writeFile(
      join(directory, floorPlansReceiptFilename(targetHash)),
      "malformed old receipt",
    );
    await store.writeFloorPlansReceipt({
      ...receipt,
      targetHash: "c".repeat(64),
    });
    const archived = await store.archiveFloorPlansReceipt(targetHash);
    expect(await readFile(join(directory, archived!), "utf8")).toBe(
      "malformed old receipt",
    );
    expect(await store.readFloorPlansReceipt(targetHash)).toBeNull();
    expect(await store.readFloorPlansReceipt("c".repeat(64))).not.toBeNull();
    expect(await store.archiveFloorPlansReceipt(targetHash)).toBeNull();
  });
  it.each(["duplicate floor", "duplicate id", "cross target", "bad hash"])(
    "rejects %s core options",
    (kind) => {
      const value = structuredClone(receipt);
      if (kind === "duplicate floor")
        value.skippedFloorIds.push(value.added[0]!.floorId);
      if (kind === "duplicate id")
        value.added.push({
          ...value.added[0]!,
          floorId: "00000000-0000-4000-8000-000000000005",
        });
      if (kind === "cross target") value.targetHash = "f".repeat(64);
      if (kind === "bad hash") value.manifestHash = "invalid";
      expect(() =>
        validateFloorPlansOptions({
          targetHash,
          databaseName: "floor",
          receipt: value,
        }),
      ).toThrow();
    },
  );
});
