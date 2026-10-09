import { asc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createSpacePhotoActions,
  type SpacePhotoDependencies,
} from "@/features/admin/photo-action-factory";
import { SPACE_PHOTO_MAX_BYTES } from "@/features/admin/photo-schema";
import { createSpacePhotoQueries } from "@/features/admin/photo-query-factory";
import { createBookingQueries } from "@/features/bookings/query-factory";
import type { Session } from "@/lib/auth/types";
import * as adminDal from "@/lib/dal/admin";
import * as photoDal from "@/lib/dal/photo-write";
import { listSpaceCoverPhotos, listSpacePhotos } from "@/lib/dal/photos";
import * as schema from "@/lib/db/schema";
import { branchStaff, roleSettings, spacePhotos } from "@/lib/db/schema";
import { adminObjectKey } from "@/lib/storage/admin-keys";
import { createMemoryAdminObjectStorage } from "@/lib/storage/admin-memory";
import {
  bookingNow,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

function webp(width = 1200, height = 750) {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBPVP8X", 8);
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  return bytes;
}
function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
describe("operator space photo actions", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  let storage: ReturnType<typeof createMemoryAdminObjectStorage>;
  let clock: Date;
  const logError = vi.fn();
  const publish = vi.fn(async () => {});
  const queries: string[] = [];
  beforeAll(async () => {
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema,
      logger: { logQuery: (query) => queries.push(query) },
    });
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    fixture = await seedBookingActors(database);
    storage = createMemoryAdminObjectStorage();
    clock = bookingNow;
    queries.length = 0;
  });
  function actions(
    session: Session | null = fixture.operator,
    overrides: Partial<SpacePhotoDependencies> = {},
  ) {
    return createSpacePhotoActions({
      database: database.db,
      getSession: async () => session,
      now: () => clock,
      storage,
      logError,
      publisher: { publish },
      ...overrides,
    });
  }
  async function rows(spaceId = fixture.publicSpaceId) {
    return database.db
      .select()
      .from(spacePhotos)
      .where(eq(spacePhotos.spaceId, spaceId))
      .orderBy(asc(spacePhotos.sortOrder));
  }
  async function seedPhotos(
    count: number,
    options: { spaceId?: string; orders?: number[] } = {},
  ) {
    if (!count) return [];
    return database.db
      .insert(spacePhotos)
      .values(
        Array.from({ length: count }, (_, index) => ({
          spaceId: options.spaceId ?? fixture.publicSpaceId,
          path: `/seed/photos/test-${index}.webp`,
          alt: `사진 ${index + 1}`,
          sortOrder: options.orders?.[index] ?? index,
        })),
      )
      .returning();
  }
  async function uploaded(
    options: {
      bytes?: Uint8Array;
      metadata?: Record<string, string>;
      contentType?: string;
      spaceId?: string;
      session?: Session;
    } = {},
  ) {
    const spaceId = options.spaceId ?? fixture.publicSpaceId;
    const result = await actions(options.session).createSpacePhotoUpload({
      spaceId,
      size: 30,
    });
    if (!result.ok) throw new Error(`Upload setup failed: ${result.code}`);
    const pending = adminObjectKey({
      kind: "pending",
      uploadId: result.data.uploadId,
    });
    const key = adminObjectKey({
      kind: "space-photo",
      photoId: result.data.uploadId,
    });
    const target = storage.uploads.get(pending);
    if (!target) throw new Error("Missing signed target.");
    storage.put(pending, options.bytes ?? webp(), {
      contentType: options.contentType,
      metadata: { ...target.metadata, ...options.metadata },
    });
    return {
      pending,
      key,
      target,
      input: {
        spaceId,
        uploadId: result.data.uploadId,
        alt: " 회의실 책상과 의자 ",
      },
    };
  }
  const names = [
    "createSpacePhotoUpload",
    "confirmSpacePhotoUpload",
    "reorderSpacePhotos",
    "updateSpacePhotoAlt",
    "deleteSpacePhoto",
  ] as const;
  it.each(names)(
    "checks the session before input, SQL, or storage for %s",
    async (name) => {
      const head = vi.spyOn(storage, "head");
      expect(await actions(null)[name](null)).toEqual({
        ok: false,
        code: "UNAUTHENTICATED",
      });
      expect(queries).toEqual([]);
      expect(head).not.toHaveBeenCalled();
    },
  );
  it.each([0, -1, 1.5, SPACE_PHOTO_MAX_BYTES + 1, Number.NaN, "30"])(
    "rejects invalid signed upload sizes before SQL: %s",
    async (size) => {
      expect(
        await actions().createSpacePhotoUpload({
          spaceId: fixture.publicSpaceId,
          size,
        }),
      ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
      expect(queries).toEqual([]);
      expect(storage.uploads.size).toBe(0);
    },
  );
  it("signs the exact bound space, owner, size, type and five-minute expiry without adding a DB row", async () => {
    const result = await actions().createSpacePhotoUpload({
      spaceId: fixture.publicSpaceId.toUpperCase(),
      size: SPACE_PHOTO_MAX_BYTES,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.data).sort()).toEqual(["uploadId", "url"]);
    expect(
      storage.uploads.get(
        adminObjectKey({ kind: "pending", uploadId: result.data.uploadId }),
      ),
    ).toEqual({
      contentType: "image/webp",
      contentLength: SPACE_PHOTO_MAX_BYTES,
      expiresIn: 300,
      metadata: {
        purpose: "space-photo",
        "uploader-id": fixture.operator.userId,
        "space-id": fixture.publicSpaceId,
        "expected-size": String(SPACE_PHOTO_MAX_BYTES),
        "expires-at": new Date(bookingNow.getTime() + 300000).toISOString(),
      },
    });
    expect(await rows()).toEqual([]);
  });
  it("rejects extra claimed owner fields before SQL", async () => {
    expect(
      await actions().createSpacePhotoUpload({
        spaceId: fixture.publicSpaceId,
        size: 30,
        uploaderId: fixture.operator.userId,
      }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(queries).toEqual([]);
  });
  it.each(["person", "admin", "otherOperator"] as const)(
    "hides a non-operated space from %s before storage",
    async (actor) => {
      const sign = vi.spyOn(storage, "createUploadUrl");
      expect(
        await actions(fixture[actor]).createSpacePhotoUpload({
          spaceId: fixture.publicSpaceId,
          size: 30,
        }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(sign).not.toHaveBeenCalled();
    },
  );
  it("rejects own disabled permission, foreign and missing space, and desks, but permits archived management", async () => {
    for (const spaceId of [
      fixture.otherSpaceId,
      crypto.randomUUID(),
      fixture.deskId,
    ])
      expect(
        await actions().createSpacePhotoUpload({ spaceId, size: 30 }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await actions().createSpacePhotoUpload({
        spaceId: fixture.archivedSpaceId,
        size: 30,
      }),
    ).toMatchObject({ ok: true });
    await database.db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "operator",
      permissions: [],
    });
    expect(
      await actions().createSpacePhotoUpload({
        spaceId: fixture.publicSpaceId,
        size: 30,
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });
  it("disables only upload actions when storage is absent", async () => {
    const [photo] = await seedPhotos(1);
    expect(photo).toBeDefined();
    const disabled = actions(fixture.operator, { storage: null });
    expect(
      await disabled.createSpacePhotoUpload({
        spaceId: fixture.publicSpaceId,
        size: 30,
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN", message: "files_disabled" });
    expect(
      await disabled.confirmSpacePhotoUpload({
        spaceId: fixture.publicSpaceId,
        uploadId: crypto.randomUUID(),
        alt: "사진",
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN", message: "files_disabled" });
    expect(
      await disabled.reorderSpacePhotos({
        spaceId: fixture.publicSpaceId,
        photoIds: [photo!.id],
      }),
    ).toMatchObject({ ok: true });
    expect(
      await disabled.updateSpacePhotoAlt({
        photoId: photo!.id,
        alt: "고친 사진",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await disabled.deleteSpacePhoto({ photoId: photo!.id }),
    ).toMatchObject({ ok: true });
  });
  it("commits one photo with a private path and publishes after the DB write", async () => {
    const upload = await uploaded();
    const head = await storage.head(upload.pending);
    const range = vi.spyOn(storage, "readRange");
    const copy = vi.spyOn(storage, "copy");
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
      ok: true,
      data: { photoId: upload.input.uploadId },
    });
    expect(await rows()).toEqual([
      {
        id: upload.input.uploadId,
        spaceId: fixture.publicSpaceId,
        path: `/api/space-photos/${upload.input.uploadId}.webp`,
        alt: "회의실 책상과 의자",
        sortOrder: 0,
      },
    ]);
    expect(range).toHaveBeenCalledExactlyOnceWith(upload.pending, 0, 1023, {
      ifMatch: head?.etag,
    });
    expect(copy).toHaveBeenCalledExactlyOnceWith(upload.pending, upload.key, {
      sourceEtag: head?.etag,
      ifAbsent: true,
    });
    expect(await storage.head(upload.pending)).toBeNull();
    expect(await storage.head(upload.key)).not.toBeNull();
    expect(publish).toHaveBeenCalledExactlyOnceWith(
      `floor:${fixture.floorId}`,
      { type: "space.status_changed", spaceId: fixture.publicSpaceId },
    );
  });
  it.each(["", "  ", "가".repeat(121), "사진\0설명"])(
    "rejects invalid alt without touching storage or SQL: %#",
    async (alt) => {
      const upload = await uploaded();
      const head = vi.spyOn(storage, "head");
      queries.length = 0;
      expect(
        await actions().confirmSpacePhotoUpload({ ...upload.input, alt }),
      ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
      expect(queries).toEqual([]);
      expect(head).not.toHaveBeenCalled();
    },
  );
  it("counts Unicode characters consistently with PostgreSQL and normalizes UUIDs", async () => {
    const upload = await uploaded();
    const alt = "🪑".repeat(120);
    expect(
      await actions().confirmSpacePhotoUpload({
        ...upload.input,
        uploadId: upload.input.uploadId.toUpperCase(),
        spaceId: upload.input.spaceId.toUpperCase(),
        alt: ` ${alt} `,
      }),
    ).toMatchObject({ ok: true });
    expect((await rows())[0]?.alt).toBe(alt);
  });
  it("prevents signing a ninth upload", async () => {
    await seedPhotos(8);
    expect(
      await actions().createSpacePhotoUpload({
        spaceId: fixture.publicSpaceId,
        size: 30,
      }),
    ).toEqual({ ok: false, code: "LIMIT_EXCEEDED" });
    expect(storage.uploads.size).toBe(0);
  });
  it("rechecks the photo cap after copy under the space lock and cleans only its new final", async () => {
    const upload = await uploaded();
    await seedPhotos(8);
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
    });
    expect(await rows()).toHaveLength(8);
    expect(await storage.head(upload.key)).toBeNull();
    expect(await storage.head(upload.pending)).not.toBeNull();
  });
  it("compacts a sparse legal order in one UPDATE before appending", async () => {
    const photos = await seedPhotos(3, { orders: [0, 8, 9] });
    const upload = await uploaded();
    queries.length = 0;
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toMatchObject(
      { ok: true },
    );
    expect((await rows()).map((photo) => [photo.id, photo.sortOrder])).toEqual([
      ...photos.map((photo, i) => [photo.id, i]),
      [upload.input.uploadId, 3],
    ]);
    expect(
      queries.filter((query) => /^update "space_photos"/.test(query)),
    ).toHaveLength(1);
    const lockedAt = queries.findIndex(
      (query) =>
        query.includes('from "spaces"') && query.includes("for update"),
    );
    const changedAt = queries.findIndex((query) =>
      /^update "space_photos"/.test(query),
    );
    expect(lockedAt).toBeGreaterThan(-1);
    expect(changedAt).toBeGreaterThan(lockedAt);
  });
  const malformedMetadata: Record<string, string>[] = [
    { purpose: "plan-background" },
    { "expected-size": "0" },
    { "expected-size": "9007199254740992" },
    { "expires-at": "bad" },
    { "uploader-id": "bad" },
    { "space-id": "bad" },
  ];
  it.each(malformedMetadata)(
    "does not clean any object with malformed or differently purposed metadata %#",
    async (metadata) => {
      const upload = await uploaded({ metadata });
      const remove = vi.spyOn(storage, "remove");
      expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
      expect(remove).not.toHaveBeenCalled();
      expect(await rows()).toEqual([]);
    },
  );
  it.each(["owner", "space"] as const)(
    "never deletes a foreign pending or final on cross-%s replay",
    async (kind) => {
      const upload = await uploaded();
      storage.put(upload.key, webp(), { metadata: upload.target.metadata });
      await database.db.insert(branchStaff).values({
        branchId: fixture.branchId,
        userId: fixture.otherOperator.userId,
      });
      const remove = vi.spyOn(storage, "remove");
      const input =
        kind === "space"
          ? { ...upload.input, spaceId: fixture.secondSpaceId }
          : upload.input;
      expect(
        await actions(
          kind === "owner" ? fixture.otherOperator : fixture.operator,
        ).confirmSpacePhotoUpload(input),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(remove).not.toHaveBeenCalled();
      expect(await storage.head(upload.pending)).not.toBeNull();
      expect(await storage.head(upload.key)).not.toBeNull();
    },
  );
  it.each([
    { bytes: webp(1199, 750) },
    { bytes: webp(1200, 751) },
    { bytes: webp(750, 1200) },
    { bytes: Buffer.from("not a webp") },
    { bytes: webp().subarray(0, 20) },
    { contentType: "image/png" },
    { bytes: Buffer.alloc(SPACE_PHOTO_MAX_BYTES + 1) },
    { metadata: { "expected-size": "31" } },
  ])(
    "rejects non-exact or invalid owned images and cleans pending %#",
    async (options) => {
      const upload = await uploaded(options);
      expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
      expect(await storage.head(upload.pending)).toBeNull();
      expect(await storage.head(upload.key)).toBeNull();
      expect(await rows()).toEqual([]);
    },
  );
  it("cleans an owned expired pending at the exact expiry boundary", async () => {
    const upload = await uploaded();
    clock = new Date(bookingNow.getTime() + 300000);
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(await storage.head(upload.pending)).toBeNull();
  });
  it("checks expiry again after copying before attaching", async () => {
    const upload = await uploaded();
    const copy = storage.copy.bind(storage);
    vi.spyOn(storage, "copy").mockImplementationOnce(async (...args) => {
      const result = await copy(...args);
      clock = new Date(bookingNow.getTime() + 300000);
      return result;
    });
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(await storage.head(upload.key)).toBeNull();
    expect(await rows()).toEqual([]);
  });
  it("uses ETag-pinned copy to reject a PUT replacement after verification", async () => {
    const upload = await uploaded();
    const copy = storage.copy.bind(storage);
    vi.spyOn(storage, "copy").mockImplementationOnce(async (...args) => {
      storage.put(upload.pending, webp(), { metadata: upload.target.metadata });
      return copy(...args);
    });
    const remove = vi.spyOn(storage, "remove");
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
      ok: false,
      code: "STALE",
    });
    expect(remove).not.toHaveBeenCalled();
    expect(await rows()).toEqual([]);
  });
  it("is idempotent after expiry, preserves edited alt, and verifies final ownership", async () => {
    const upload = await uploaded();
    const first = await actions().confirmSpacePhotoUpload(upload.input);
    await actions().updateSpacePhotoAlt({
      photoId: upload.input.uploadId,
      alt: "나중 설명",
    });
    await database.db.insert(branchStaff).values({
      branchId: fixture.branchId,
      userId: fixture.otherOperator.userId,
    });
    clock = new Date(bookingNow.getTime() + 3600000);
    const copy = vi.spyOn(storage, "copy");
    publish.mockClear();
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual(
      first,
    );
    expect(
      await actions(fixture.otherOperator).confirmSpacePhotoUpload(
        upload.input,
      ),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(copy).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(1);
    expect((await rows())[0]?.alt).toBe("나중 설명");
    expect(publish).not.toHaveBeenCalled();
    expect(await storage.head(upload.key)).not.toBeNull();
  });
  it.each([true, false])(
    "never adopts or deletes an unlinked copy winner (pending present: %s)",
    async (pendingPresent) => {
      const upload = await uploaded();
      storage.put(upload.key, webp(), { metadata: upload.target.metadata });
      if (!pendingPresent) await storage.remove(upload.pending);
      const remove = vi.spyOn(storage, "remove");
      expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
        ok: false,
        code: "STALE",
      });
      expect(remove).not.toHaveBeenCalled();
      expect(await rows()).toEqual([]);
      expect(await storage.head(upload.key)).not.toBeNull();
    },
  );
  it("serializes two confirms and never lets a copy loser clean the winner", async () => {
    const upload = await uploaded();
    const paused = gate();
    const resume = gate();
    const copy = storage.copy.bind(storage);
    vi.spyOn(storage, "copy").mockImplementation(async (...args) => {
      const value = await copy(...args);
      if (value === "created") {
        paused.release();
        await resume.promise;
      }
      return value;
    });
    const first = actions().confirmSpacePhotoUpload(upload.input);
    await paused.promise;
    try {
      expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
        ok: false,
        code: "STALE",
      });
      expect(await storage.head(upload.key)).not.toBeNull();
    } finally {
      resume.release();
    }
    expect(await first).toMatchObject({ ok: true });
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual(
      await first,
    );
    expect(await rows()).toHaveLength(1);
  });
  it.each(["initial snapshot", "range missing", "range network"] as const)(
    "recovers only a proven duplicate after %s races with pending cleanup",
    async (pauseAt) => {
      const upload = await uploaded();
      const paused = gate();
      const resume = gate();
      if (pauseAt === "initial snapshot") {
        const read = photoDal.readPhotoForMutation;
        vi.spyOn(photoDal, "readPhotoForMutation").mockImplementationOnce(
          async (...args) => {
            const snapshot = await read(...args);
            paused.release();
            await resume.promise;
            return snapshot;
          },
        );
      } else {
        const read = storage.readRange.bind(storage);
        vi.spyOn(storage, "readRange").mockImplementationOnce(
          async (...args) => {
            paused.release();
            await resume.promise;
            if (pauseAt === "range network") throw new Error("network");
            return read(...args);
          },
        );
      }
      const first = actions().confirmSpacePhotoUpload(upload.input);
      await paused.promise;
      const second = await actions()
        .confirmSpacePhotoUpload(upload.input)
        .finally(resume.release);
      expect(second).toMatchObject({ ok: true });
      expect(await first).toEqual(
        pauseAt === "range network" ? { ok: false, code: "INTERNAL" } : second,
      );
      expect(await rows()).toHaveLength(1);
      expect(await storage.head(upload.key)).not.toBeNull();
      expect(publish).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["membership", "permission"] as const)(
    "rechecks revoked %s after locking and rolls back its copied object",
    async (kind) => {
      const upload = await uploaded();
      const lock = adminDal.lockAdminSpace;
      vi.spyOn(adminDal, "lockAdminSpace").mockImplementationOnce(
        async (id, tx) => {
          if (!tx) throw new Error("Missing transaction.");
          const space = await lock(id, tx);
          if (kind === "membership")
            await tx
              .delete(branchStaff)
              .where(eq(branchStaff.userId, fixture.operator.userId));
          else
            await tx.insert(roleSettings).values({
              branchId: fixture.branchId,
              role: "operator",
              permissions: [],
            });
          return space;
        },
      );
      expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
        ok: false,
        code: kind === "membership" ? "NOT_FOUND" : "FORBIDDEN",
      });
      expect(await storage.head(upload.key)).toBeNull();
      expect(await rows()).toEqual([]);
    },
  );
  it("rolls back sparse compaction and insert on a late DB failure and cleans only the new final", async () => {
    await seedPhotos(2, { orders: [8, 9] });
    const before = await rows();
    const upload = await uploaded();
    const insert = photoDal.insertSpacePhoto;
    vi.spyOn(photoDal, "insertSpacePhoto").mockImplementationOnce(
      async (...args) => {
        await insert(...args);
        throw new Error("secret storage token");
      },
    );
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(await rows()).toEqual(before);
    expect(await storage.head(upload.key)).toBeNull();
    expect(publish).not.toHaveBeenCalled();
    expect(JSON.stringify(logError.mock.calls)).not.toContain("secret");
  });
  it("preserves the final on an ambiguous COMMIT outcome and safely confirms again", async () => {
    const upload = await uploaded();
    const transaction = database.db.transaction.bind(database.db);
    vi.spyOn(database.db, "transaction").mockImplementationOnce(
      async (callback) => {
        await transaction(callback);
        throw new Error("lost commit response");
      },
    );
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(await rows()).toHaveLength(1);
    expect(await storage.head(upload.key)).not.toBeNull();
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toMatchObject(
      { ok: true },
    );
  });
  it("preserves ambiguous copy results without later adopting an orphan", async () => {
    const upload = await uploaded();
    const copy = storage.copy.bind(storage);
    vi.spyOn(storage, "copy").mockImplementationOnce(async (...args) => {
      await copy(...args);
      throw new Error("lost copy response");
    });
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
      ok: false,
      code: "STALE",
    });
    expect(await storage.head(upload.key)).not.toBeNull();
    expect(await rows()).toEqual([]);
  });
  it("keeps committed success after cleanup, publication, and logger failures", async () => {
    const upload = await uploaded();
    vi.spyOn(storage, "remove").mockRejectedValue(new Error("private"));
    expect(
      await actions(fixture.operator, {
        publisher: { publish: vi.fn().mockRejectedValue(new Error("publish")) },
        logError: () => {
          throw new Error("logger");
        },
      }).confirmSpacePhotoUpload(upload.input),
    ).toMatchObject({ ok: true });
    expect(await rows()).toHaveLength(1);
    expect(await storage.head(upload.key)).not.toBeNull();
  });
  it("swaps all ten existing photos in one statement without temporary out-of-range orders", async () => {
    const before = await seedPhotos(10);
    const photoIds = before.map((photo) => photo.id).reverse();
    queries.length = 0;
    expect(
      await actions().reorderSpacePhotos({
        spaceId: fixture.publicSpaceId,
        photoIds,
      }),
    ).toEqual({ ok: true, data: { spaceId: fixture.publicSpaceId } });
    expect((await rows()).map((photo) => photo.id)).toEqual(photoIds);
    const writes = queries.filter((query) =>
      /^update "space_photos"/.test(query),
    );
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("from (values");
    expect((await rows()).map((photo) => photo.sortOrder)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });
  it.each(["duplicate", "missing", "extra", "foreign"] as const)(
    "rejects a %s non-permutation without mutation",
    async (kind) => {
      const before = await seedPhotos(2);
      const [foreign] = await seedPhotos(1, { spaceId: fixture.secondSpaceId });
      const ids = before.map((photo) => photo.id);
      const photoIds =
        kind === "duplicate"
          ? [ids[0], ids[0]]
          : kind === "missing"
            ? ids.slice(1)
            : kind === "foreign"
              ? [ids[0], foreign!.id]
              : [...ids, crypto.randomUUID()];
      expect(
        await actions().reorderSpacePhotos({
          spaceId: fixture.publicSpaceId,
          photoIds,
        }),
      ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
      expect(await rows()).toEqual(before);
    },
  );
  it("accepts the empty permutation for a space with no photos", async () => {
    expect(
      await actions().reorderSpacePhotos({
        spaceId: fixture.publicSpaceId,
        photoIds: [],
      }),
    ).toEqual({ ok: true, data: { spaceId: fixture.publicSpaceId } });
  });
  it("updates alt only and rejects invalid alt before locating a photo", async () => {
    const [before] = await seedPhotos(1);
    expect(
      await actions().updateSpacePhotoAlt({
        photoId: before!.id,
        alt: " 고친 설명 ",
      }),
    ).toEqual({ ok: true, data: { spaceId: fixture.publicSpaceId } });
    expect((await rows())[0]).toEqual({ ...before, alt: "고친 설명" });
    queries.length = 0;
    expect(
      await actions().updateSpacePhotoAlt({ photoId: before!.id, alt: "\0" }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(queries).toEqual([]);
  });
  it.each(["updateSpacePhotoAlt", "deleteSpacePhoto"] as const)(
    "hides unknown or foreign photo targets in %s",
    async (name) => {
      const [photo] = await seedPhotos(1, { spaceId: fixture.otherSpaceId });
      for (const photoId of [photo!.id, crypto.randomUUID()]) {
        const input =
          name === "updateSpacePhotoAlt"
            ? { photoId, alt: "사진" }
            : { photoId };
        expect(await actions()[name](input)).toEqual({
          ok: false,
          code: "NOT_FOUND",
        });
      }
    },
  );
  it.each(["updateSpacePhotoAlt", "deleteSpacePhoto"] as const)(
    "reads only a photo space identifier before denying a non-operator %s",
    async (name) => {
      const [photo] = await seedPhotos(1);
      if (!photo) throw new Error("Missing photo.");
      queries.length = 0;
      const input =
        name === "updateSpacePhotoAlt"
          ? { photoId: photo.id, alt: "변경" }
          : { photoId: photo.id };
      expect(await actions(fixture.person)[name](input)).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
      const photoQueries = queries.filter((query) =>
        query.includes('from "space_photos"'),
      );
      expect(photoQueries).toHaveLength(1);
      expect(photoQueries[0]).toMatch(/^select "space_id" from "space_photos"/);
      expect(photoQueries[0]).not.toContain('"path"');
      expect(photoQueries[0]).not.toContain('"alt"');
    },
  );
  it("deletes a seed row and compacts remaining order without touching storage", async () => {
    const photos = await seedPhotos(3, { orders: [0, 8, 9] });
    const remove = vi.spyOn(storage, "remove");
    queries.length = 0;
    expect(
      await actions().deleteSpacePhoto({ photoId: photos[1]!.id }),
    ).toEqual({ ok: true, data: { spaceId: fixture.publicSpaceId } });
    expect((await rows()).map((photo) => [photo.id, photo.sortOrder])).toEqual([
      [photos[0]!.id, 0],
      [photos[2]!.id, 1],
    ]);
    expect(remove).not.toHaveBeenCalled();
    expect(
      queries.filter((query) => /^update "space_photos"/.test(query)),
    ).toHaveLength(1);
  });
  it("removes an uploaded object only after its row is committed deleted", async () => {
    const upload = await uploaded();
    await actions().confirmSpacePhotoUpload(upload.input);
    const remove = storage.remove.bind(storage);
    vi.spyOn(storage, "remove").mockImplementation(async (key) => {
      expect(await rows()).toEqual([]);
      return remove(key);
    });
    expect(
      await actions().deleteSpacePhoto({ photoId: upload.input.uploadId }),
    ).toMatchObject({ ok: true });
    expect(await storage.head(upload.key)).toBeNull();
    expect(
      await actions().deleteSpacePhoto({ photoId: upload.input.uploadId }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });
  it("cleans a retained pending on deletion so an ordinary late confirmation cannot resurrect the photo", async () => {
    const upload = await uploaded();
    const remove = vi
      .spyOn(storage, "remove")
      .mockRejectedValueOnce(new Error("first pending cleanup failed"));
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toMatchObject(
      { ok: true },
    );
    expect(await storage.head(upload.pending)).not.toBeNull();
    remove.mockClear();
    expect(
      await actions().deleteSpacePhoto({ photoId: upload.input.uploadId }),
    ).toMatchObject({ ok: true });
    expect(remove.mock.calls.map(([key]) => key).sort()).toEqual(
      [upload.pending, upload.key].sort(),
    );
    expect(await storage.head(upload.pending)).toBeNull();
    expect(await storage.head(upload.key)).toBeNull();
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await rows()).toEqual([]);
  });
  it("documents the bounded replay limitation when both pending cleanup attempts fail", async () => {
    const upload = await uploaded();
    const remove = storage.remove.bind(storage);
    const cleanup = vi
      .spyOn(storage, "remove")
      .mockImplementation(async (key) => {
        if (key === upload.pending) throw new Error("pending cleanup failed");
        return remove(key);
      });
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toMatchObject(
      { ok: true },
    );
    expect(
      await actions().deleteSpacePhoto({ photoId: upload.input.uploadId }),
    ).toMatchObject({ ok: true });
    expect(await rows()).toEqual([]);
    expect(await storage.head(upload.pending)).not.toBeNull();
    expect(await storage.head(upload.key)).toBeNull();
    cleanup.mockRestore();
    // 영구 upload tombstone은 없으므로 같은 사용자·공간의 유효 서명은 5분 동안 다시 쓸 수 있다.
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
      ok: true,
      data: { photoId: upload.input.uploadId },
    });
    expect(await rows()).toHaveLength(1);
  });
  it.each([false, true])(
    "documents signed PUT replay after deletion while enforcing expiry (expired: %s)",
    async (expired) => {
      const upload = await uploaded();
      expect(
        await actions().confirmSpacePhotoUpload(upload.input),
      ).toMatchObject({ ok: true });
      expect(
        await actions().deleteSpacePhoto({ photoId: upload.input.uploadId }),
      ).toMatchObject({ ok: true });
      expect(await storage.head(upload.pending)).toBeNull();
      expect(await storage.head(upload.key)).toBeNull();
      clock = new Date(bookingNow.getTime() + (expired ? 300000 : 299999));
      storage.put(upload.pending, webp(), { metadata: upload.target.metadata });
      expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual(
        expired
          ? { ok: false, code: "INVALID_INPUT" }
          : { ok: true, data: { photoId: upload.input.uploadId } },
      );
      expect(await rows()).toHaveLength(expired ? 0 : 1);
      expect(await storage.head(upload.pending)).toBeNull();
    },
  );
  it("keeps deletion committed when storage is disabled or its cleanup fails", async () => {
    const first = await uploaded();
    await actions().confirmSpacePhotoUpload(first.input);
    expect(
      await actions(fixture.operator, { storage: null }).deleteSpacePhoto({
        photoId: first.input.uploadId,
      }),
    ).toMatchObject({ ok: true });
    const second = await uploaded();
    await actions().confirmSpacePhotoUpload(second.input);
    vi.spyOn(storage, "remove").mockRejectedValue(new Error("private"));
    expect(
      await actions(fixture.operator, {
        logError: () => {
          throw new Error("logger");
        },
      }).deleteSpacePhoto({ photoId: second.input.uploadId }),
    ).toMatchObject({ ok: true });
    expect(await rows()).toEqual([]);
    expect(await storage.head(first.key)).not.toBeNull();
    expect(await storage.head(second.key)).not.toBeNull();
  });
  it("rolls deletion back when compaction fails and never removes its object", async () => {
    const upload = await uploaded();
    await actions().confirmSpacePhotoUpload(upload.input);
    const before = await rows();
    vi.spyOn(photoDal, "writeSpacePhotoOrder").mockRejectedValueOnce(
      new Error("write"),
    );
    const remove = vi.spyOn(storage, "remove");
    expect(
      await actions().deleteSpacePhoto({ photoId: upload.input.uploadId }),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(await rows()).toEqual(before);
    expect(remove).not.toHaveBeenCalled();
    expect(await storage.head(upload.key)).not.toBeNull();
  });
  it("allows only one of two signed uploads to occupy the eighth slot", async () => {
    await seedPhotos(7);
    const first = await uploaded();
    const second = await uploaded();
    const results = await Promise.all([
      actions().confirmSpacePhotoUpload(first.input),
      actions().confirmSpacePhotoUpload(second.input),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, code: "LIMIT_EXCEEDED" },
    ]);
    const winner = results[0]?.ok ? first : second;
    const loser = winner === first ? second : first;
    expect(await storage.head(winner.key)).not.toBeNull();
    expect(await storage.head(loser.key)).toBeNull();
    expect(await rows()).toHaveLength(8);
  });
  it.each([
    "reorderSpacePhotos",
    "updateSpacePhotoAlt",
    "deleteSpacePhoto",
  ] as const)(
    "rechecks permission under the space lock for %s",
    async (name) => {
      const photos = await seedPhotos(2);
      const before = await rows();
      const lock = adminDal.lockAdminSpace;
      vi.spyOn(adminDal, "lockAdminSpace").mockImplementationOnce(
        async (id, tx) => {
          if (!tx) throw new Error("Missing transaction.");
          const row = await lock(id, tx);
          await tx.insert(roleSettings).values({
            branchId: fixture.branchId,
            role: "operator",
            permissions: [],
          });
          return row;
        },
      );
      const input =
        name === "reorderSpacePhotos"
          ? {
              spaceId: fixture.publicSpaceId,
              photoIds: photos.map((photo) => photo.id).reverse(),
            }
          : name === "updateSpacePhotoAlt"
            ? { photoId: photos[0]!.id, alt: "변경" }
            : { photoId: photos[0]!.id };
      expect(await actions()[name](input)).toEqual({
        ok: false,
        code: "FORBIDDEN",
      });
      expect(await rows()).toEqual(before);
      expect(publish).not.toHaveBeenCalled();
    },
  );
  it("reads only identifiers and a path match boolean for a confirmation snapshot", async () => {
    const [photo] = await seedPhotos(1);
    if (!photo) throw new Error("Missing photo.");
    expect(await photoDal.readPhotoForMutation(photo.id, database.db)).toEqual({
      id: photo.id,
      spaceId: photo.spaceId,
      pathMatches: false,
    });
    const upload = await uploaded();
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toMatchObject(
      { ok: true },
    );
    expect(
      await photoDal.readPhotoForMutation(upload.input.uploadId, database.db),
    ).toEqual({
      id: upload.input.uploadId,
      spaceId: fixture.publicSpaceId,
      pathMatches: true,
    });
  });
  it.each(["foreign space", "mismatched path"] as const)(
    "rejects a previously stored photo with %s without storage access",
    async (kind) => {
      const upload = await uploaded();
      await database.db.insert(spacePhotos).values({
        id: upload.input.uploadId,
        spaceId:
          kind === "foreign space"
            ? fixture.secondSpaceId
            : fixture.publicSpaceId,
        path:
          kind === "mismatched path"
            ? "/seed/photos/old.webp"
            : `/api/space-photos/${upload.input.uploadId}.webp`,
        alt: "원래 사진",
        sortOrder: 0,
      });
      const head = vi.spyOn(storage, "head");
      const remove = vi.spyOn(storage, "remove");
      expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
      expect(head).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    },
  );
  it.each(["owner", "space", "malformed", "size", "dimensions"] as const)(
    "verifies saved final %s on replay without cleaning someone else's object",
    async (kind) => {
      const upload = await uploaded();
      await actions().confirmSpacePhotoUpload(upload.input);
      const metadata = { ...upload.target.metadata };
      if (kind === "owner")
        metadata["uploader-id"] = fixture.otherOperator.userId;
      if (kind === "space") metadata["space-id"] = fixture.secondSpaceId;
      if (kind === "malformed") metadata.purpose = "other";
      if (kind === "size") metadata["expected-size"] = "31";
      storage.put(
        upload.key,
        kind === "dimensions" ? webp(1199, 750) : webp(),
        { metadata },
      );
      const before = await rows();
      const remove = vi.spyOn(storage, "remove");
      expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
        ok: false,
        code:
          kind === "size" || kind === "dimensions"
            ? "INVALID_INPUT"
            : "NOT_FOUND",
      });
      expect(remove).not.toHaveBeenCalled();
      expect(await rows()).toEqual(before);
    },
  );
  it("accepts a copy loser only after the winner has linked the exact final", async () => {
    const upload = await uploaded();
    const copy = storage.copy.bind(storage);
    vi.spyOn(storage, "copy").mockImplementationOnce(async (...args) => {
      await copy(...args);
      await database.db.insert(spacePhotos).values({
        id: upload.input.uploadId,
        spaceId: fixture.publicSpaceId,
        path: `/api/space-photos/${upload.input.uploadId}.webp`,
        alt: "승자 설명",
        sortOrder: 0,
      });
      return "exists";
    });
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
      ok: true,
      data: { photoId: upload.input.uploadId },
    });
    expect((await rows())[0]?.alt).toBe("승자 설명");
    expect(publish).not.toHaveBeenCalled();
    expect(await storage.head(upload.key)).not.toBeNull();
  });
  it("does not clean an uploaded object when deletion COMMIT acknowledgement is lost", async () => {
    const upload = await uploaded();
    await actions().confirmSpacePhotoUpload(upload.input);
    const transaction = database.db.transaction.bind(database.db);
    vi.spyOn(database.db, "transaction").mockImplementationOnce(
      async (callback) => {
        await transaction(callback);
        throw new Error("lost commit response");
      },
    );
    const remove = vi.spyOn(storage, "remove");
    expect(
      await actions().deleteSpacePhoto({ photoId: upload.input.uploadId }),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(await rows()).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
    expect(await storage.head(upload.key)).not.toBeNull();
  });
  it("rolls back a reorder if its conditional result is incomplete", async () => {
    const photos = await seedPhotos(2);
    const before = await rows();
    const write = photoDal.writeSpacePhotoOrder;
    vi.spyOn(photoDal, "writeSpacePhotoOrder").mockImplementationOnce(
      async (...args) => {
        await write(...args);
        return [];
      },
    );
    expect(
      await actions().reorderSpacePhotos({
        spaceId: fixture.publicSpaceId,
        photoIds: photos.map((photo) => photo.id).reverse(),
      }),
    ).toEqual({ ok: false, code: "STALE" });
    expect(await rows()).toEqual(before);
  });
  it("does not mask arbitrary storage failures or clean their unowned outcome", async () => {
    const upload = await uploaded();
    vi.spyOn(storage, "readRange").mockRejectedValueOnce(
      new Error("private endpoint"),
    );
    const remove = vi.spyOn(storage, "remove");
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(remove).not.toHaveBeenCalled();
    expect(await rows()).toEqual([]);
    expect(JSON.stringify(logError.mock.calls)).not.toContain(
      "private endpoint",
    );
  });
  it("moves the uploaded photo to the cover using the unchanged member projections", async () => {
    await seedPhotos(2);
    const upload = await uploaded();
    await actions().confirmSpacePhotoUpload(upload.input);
    const photos = await rows();
    expect(
      await actions().reorderSpacePhotos({
        spaceId: fixture.publicSpaceId,
        photoIds: [
          upload.input.uploadId,
          ...photos
            .filter((photo) => photo.id !== upload.input.uploadId)
            .map((photo) => photo.id),
        ],
      }),
    ).toMatchObject({ ok: true });
    const expected = {
      path: `/api/space-photos/${upload.input.uploadId}.webp`,
      alt: "회의실 책상과 의자",
    };
    expect(
      (await listSpacePhotos(fixture.publicSpaceId, database.db))[0],
    ).toEqual(expected);
    expect(
      await listSpaceCoverPhotos([fixture.publicSpaceId], database.db),
    ).toEqual([{ ...expected, spaceId: fixture.publicSpaceId }]);
    const detail = await createBookingQueries({
      database: database.db,
      now: () => clock,
      requireSession: async () => fixture.person,
    }).getSpaceDay(fixture.branchId, fixture.floorId, fixture.publicSpaceId);
    expect(detail.photos[0]).toEqual(expected);
    expect(detail.space.photo).toEqual(expected);
    const response = await createSpacePhotoQueries({
      database: database.db,
      requireSession: async () => fixture.person,
      storage,
    }).getSpacePhoto(`${upload.input.uploadId}.webp`);
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      Uint8Array.from(webp()),
    );
  });
  it("keeps an uploaded restricted photo inaccessible to an unrelated member", async () => {
    const upload = await uploaded({ spaceId: fixture.restrictedSpaceId });
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toMatchObject(
      { ok: true },
    );
    const read = vi.spyOn(storage, "readStream");
    const response = await createSpacePhotoQueries({
      database: database.db,
      requireSession: async () => fixture.person,
      storage,
    }).getSpacePhoto(`${upload.input.uploadId}.webp`);
    expect(response.status).toBe(404);
    expect(read).not.toHaveBeenCalled();
  });
  it("accepts a correctly sized WebP at exactly one MiB", async () => {
    const bytes = Buffer.alloc(SPACE_PHOTO_MAX_BYTES);
    webp().copy(bytes);
    const result = await actions().createSpacePhotoUpload({
      spaceId: fixture.publicSpaceId,
      size: bytes.length,
    });
    if (!result.ok) throw new Error("Upload setup failed.");
    const pending = adminObjectKey({
      kind: "pending",
      uploadId: result.data.uploadId,
    });
    storage.put(pending, bytes, {
      metadata: storage.uploads.get(pending)?.metadata,
    });
    expect(
      await actions().confirmSpacePhotoUpload({
        spaceId: fixture.publicSpaceId,
        uploadId: result.data.uploadId,
        alt: "회의실",
      }),
    ).toMatchObject({ ok: true });
    expect(await rows()).toHaveLength(1);
  });
  it("does not clean a pending object whose binding fields are absent", async () => {
    const upload = await uploaded();
    storage.put(upload.pending, webp(), { metadata: {} });
    const remove = vi.spyOn(storage, "remove");
    expect(await actions().confirmSpacePhotoUpload(upload.input)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(remove).not.toHaveBeenCalled();
  });
  it("never deletes a mismatched API path target while deleting its row", async () => {
    const upload = await uploaded();
    await actions().confirmSpacePhotoUpload(upload.input);
    const [wrong] = await database.db
      .insert(spacePhotos)
      .values({
        spaceId: fixture.secondSpaceId,
        path: `/api/space-photos/${upload.input.uploadId}.webp`,
        alt: "잘못된 연결",
        sortOrder: 0,
      })
      .returning();
    if (!wrong) throw new Error("Missing photo.");
    const remove = vi.spyOn(storage, "remove");
    expect(
      await actions().deleteSpacePhoto({ photoId: wrong.id }),
    ).toMatchObject({ ok: true });
    expect(remove).not.toHaveBeenCalled();
    expect(await storage.head(upload.key)).not.toBeNull();
  });
});
