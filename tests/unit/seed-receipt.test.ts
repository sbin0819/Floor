import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bookingRound2HostHash,
  type BookingRound2Receipt,
} from "@/lib/seed/booking-round2-receipt";
import {
  createSeedReceiptStore,
  seedReceiptFilename,
} from "@/scripts/seed-receipt";

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID: vi.fn(actual.randomUUID) };
});

let directory: string;
const hostHash = bookingRound2HostHash("remote.example.test");
const receipt: BookingRound2Receipt = {
  version: 1,
  mode: "booking-round2",
  hostHash,
  manifestHash: "a".repeat(64),
  appliedAt: "2026-10-08T05:00:00.000Z",
  bundleHash: "b".repeat(64),
};
beforeEach(async () => {
  const actual =
    await vi.importActual<typeof import("node:crypto")>("node:crypto");
  vi.mocked(randomUUID).mockImplementation(actual.randomUUID);
  directory = await mkdtemp(join(tmpdir(), "floor-seed-receipt-test-"));
});

describe("receipt archive after an explicit data reset", () => {
  it("does not create a folder when the current host has no receipt", async () => {
    const nested = join(directory, "not-created");
    expect(
      await createSeedReceiptStore(nested).archiveReceipt(hostHash),
    ).toBeNull();
    await expect(stat(nested)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("preserves the current host receipt in the same directory and leaves other hosts untouched", async () => {
    const store = createSeedReceiptStore(directory);
    const otherHash = bookingRound2HostHash("other.example.test");
    const otherReceipt = { ...receipt, hostHash: otherHash };
    await store.writeReceipt(receipt);
    await store.writeReceipt(otherReceipt);
    const archived = await store.archiveReceipt(hostHash);
    expect(archived).toMatch(
      new RegExp(
        `^${seedReceiptFilename(hostHash)}\\.[a-f0-9-]+\\.reset-archive$`,
        "u",
      ),
    );
    expect(await store.readReceipt(hostHash)).toBeNull();
    expect(await store.readReceipt(otherHash)).toEqual(otherReceipt);
    expect(
      JSON.parse(await readFile(join(directory, archived!), "utf8")),
    ).toEqual(receipt);
    expect((await stat(join(directory, archived!))).mode & 0o777).toBe(0o600);
    expect((await readdir(directory)).sort()).toEqual(
      [archived, seedReceiptFilename(otherHash)].sort(),
    );
  });

  it("does not overwrite an existing archive even if its generated name collides", async () => {
    const archiveId = "e6c4ca43-82cd-4b74-9dcd-932f05a058df";
    vi.mocked(randomUUID).mockReturnValue(archiveId);
    const archived = `${seedReceiptFilename(hostHash)}.${archiveId}.reset-archive`;
    await writeFile(join(directory, archived), "existing recoverable contents");
    const store = createSeedReceiptStore(directory);
    await store.writeReceipt(receipt);
    await expect(store.archiveReceipt(hostHash)).rejects.toMatchObject({
      code: "EEXIST",
    });
    expect(await readFile(join(directory, archived), "utf8")).toBe(
      "existing recoverable contents",
    );
    expect(await store.readReceipt(hostHash)).toEqual(receipt);
  });

  it("keeps multiple reset archives independently recoverable", async () => {
    const store = createSeedReceiptStore(directory);
    await store.writeReceipt(receipt);
    const first = await store.archiveReceipt(hostHash);
    const changed = { ...receipt, bundleHash: "d".repeat(64) };
    await store.writeReceipt(changed);
    const second = await store.archiveReceipt(hostHash);
    expect(first).not.toEqual(second);
    expect(await readdir(directory)).toHaveLength(2);
    expect(JSON.parse(await readFile(join(directory, first!), "utf8"))).toEqual(
      receipt,
    );
    expect(
      JSON.parse(await readFile(join(directory, second!), "utf8")),
    ).toEqual(changed);
  });

  it("preserves malformed old receipt bytes without parsing or repairing them", async () => {
    const target = join(directory, seedReceiptFilename(hostHash));
    await writeFile(target, "old invalid receipt contents", { mode: 0o600 });
    const archived =
      await createSeedReceiptStore(directory).archiveReceipt(hostHash);
    expect(await readFile(join(directory, archived!), "utf8")).toBe(
      "old invalid receipt contents",
    );
    await expect(stat(target)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not follow or archive symlinks", async () => {
    const target = join(directory, seedReceiptFilename(hostHash));
    const unrelated = join(directory, "unrelated.json");
    await writeFile(unrelated, "preserved");
    await symlink(unrelated, target);
    await expect(
      createSeedReceiptStore(directory).archiveReceipt(hostHash),
    ).rejects.toThrow("일반 파일");
    expect(await readFile(unrelated, "utf8")).toBe("preserved");
    expect(await readdir(directory)).toHaveLength(2);
  });

  it.each(["../escape", "", "A".repeat(64)])(
    "rejects invalid host digests before touching any file: %s",
    async (invalid) => {
      await expect(
        createSeedReceiptStore(directory).archiveReceipt(invalid),
      ).rejects.toThrow("호스트 식별자");
      expect(await readdir(directory)).toEqual([]);
    },
  );
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe("booking-round2 local receipt persistence", () => {
  it("uses a normalized hostname digest without retaining credentials or the host text", () => {
    expect(bookingRound2HostHash("REMOTE.EXAMPLE.TEST")).toBe(hostHash);
    expect(seedReceiptFilename(hostHash)).toBe(
      `booking-round2-v1-${hostHash}.json`,
    );
    expect(seedReceiptFilename(hostHash)).not.toContain("remote.example.test");
  });
  it("returns null for a genuinely absent file without creating directories", async () => {
    const nested = join(directory, "not-created");
    expect(
      await createSeedReceiptStore(nested).readReceipt(hostHash),
    ).toBeNull();
    await expect(stat(nested)).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("writes complete restrictive JSON atomically and reads the strict contract", async () => {
    const store = createSeedReceiptStore(directory);
    await store.writeReceipt(receipt);
    expect(await store.readReceipt(hostHash)).toEqual(receipt);
    expect(await readdir(directory)).toEqual([seedReceiptFilename(hostHash)]);
    const target = join(directory, seedReceiptFilename(hostHash));
    expect(JSON.parse(await readFile(target, "utf8"))).toEqual(receipt);
    expect((await stat(target)).mode & 0o777).toBe(0o600);
  });
  it("never overwrites an existing receipt, even when the contents differ", async () => {
    const store = createSeedReceiptStore(directory);
    await store.writeReceipt(receipt);
    await expect(
      store.writeReceipt({ ...receipt, bundleHash: "c".repeat(64) }),
    ).rejects.toMatchObject({ code: "EEXIST" });
    expect(await store.readReceipt(hostHash)).toEqual(receipt);
    expect(await readdir(directory)).toEqual([seedReceiptFilename(hostHash)]);
  });
  it("allows exactly one complete publication when two writers race", async () => {
    const store = createSeedReceiptStore(directory);
    const results = await Promise.allSettled([
      store.writeReceipt(receipt),
      store.writeReceipt(receipt),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === "rejected"),
    ).toHaveLength(1);
    expect(await store.readReceipt(hostHash)).toEqual(receipt);
    expect(await readdir(directory)).toEqual([seedReceiptFilename(hostHash)]);
  });
  it.each(["../escape", "A".repeat(64), "a".repeat(63), ""])(
    "rejects invalid filename digest %s before touching a path",
    async (value) => {
      expect(() => seedReceiptFilename(value)).toThrow("호스트 식별자");
      await expect(
        createSeedReceiptStore(directory).readReceipt(value),
      ).rejects.toThrow("호스트 식별자");
      expect(await readdir(directory)).toEqual([]);
    },
  );
  it.each([
    { ...receipt, version: 2 },
    { ...receipt, mode: "all" },
    { ...receipt, hostHash: "c".repeat(64) },
    { ...receipt, extra: "private-secret" },
    { ...receipt, bundleHash: "invalid" },
    { ...receipt, appliedAt: "today" },
  ])("fails closed for mismatched or malformed contract %j", async (value) => {
    await writeFile(
      join(directory, seedReceiptFilename(hostHash)),
      JSON.stringify(value),
    );
    await expect(
      createSeedReceiptStore(directory).readReceipt(hostHash),
    ).rejects.toThrow("적용 표식을 읽지 못했어요");
  });
  it("does not expose invalid JSON or follow receipt symlinks", async () => {
    const target = join(directory, seedReceiptFilename(hostHash));
    await writeFile(target, "private-secret-invalid-json");
    const store = createSeedReceiptStore(directory);
    const error = await store
      .readReceipt(hostHash)
      .catch((error: unknown) => error);
    expect(String(error)).not.toContain("private-secret");
    await rm(target);
    await writeFile(join(directory, "other.json"), JSON.stringify(receipt));
    await symlink(join(directory, "other.json"), target);
    await expect(store.readReceipt(hostHash)).rejects.toThrow(
      "적용 표식을 읽지 못했어요",
    );
  });
});
