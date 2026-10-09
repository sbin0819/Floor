import { eq } from "drizzle-orm";
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
  createPlanBackgroundActions,
  type PlanBackgroundDependencies,
} from "@/features/floor-plan/background-action-factory";
import { createPlanBackgroundQueries } from "@/features/floor-plan/background-query-factory";
import { createPlanEditorActions } from "@/features/floor-plan/editor-action-factory";
import { createPlanEditorQueries } from "@/features/floor-plan/editor-query-factory";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import * as backgroundDal from "@/lib/dal/plan-backgrounds";
import * as schema from "@/lib/db/schema";
import { branchStaff, floorPlans, roleSettings } from "@/lib/db/schema";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import { adminObjectKey } from "@/lib/storage/admin-keys";
import { createMemoryAdminObjectStorage } from "@/lib/storage/admin-memory";
import {
  bookingNow,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

function webp(width = 640, height = 480) {
  const bytes = Buffer.alloc(30);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(22, 4);
  bytes.write("WEBPVP8X", 8);
  bytes.writeUIntLE(width - 1, 24, 3);
  bytes.writeUIntLE(height - 1, 27, 3);
  return bytes;
}
const document: FloorPlanDocument = {
  schema: 1,
  unit: "mm",
  bounds: { w: 30000, h: 20000 },
  walls: [],
  openings: [],
  spaces: [],
  seats: [],
  fixtures: [],
};
describe("private floor-plan backgrounds", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  let draft: typeof floorPlans.$inferSelect;
  let storage: ReturnType<typeof createMemoryAdminObjectStorage>;
  let clock: Date;
  let meter: ReturnType<typeof createQueryMeter>;
  const queries: string[] = [];
  const logError = vi.fn();
  beforeAll(async () => {
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema,
      logger: { logQuery: (query) => queries.push(query) },
    });
    meter = createQueryMeter(database.client);
  });
  afterAll(async () => {
    meter.restore();
    await database.client.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    fixture = await seedBookingActors(database);
    const [row] = await database.db
      .insert(floorPlans)
      .values({
        floorId: fixture.floorId,
        version: 1,
        status: "draft",
        document,
        createdBy: fixture.operator.userId,
        updatedBy: fixture.operator.userId,
        createdAt: bookingNow,
        updatedAt: bookingNow,
        revision: 4,
      })
      .returning();
    if (!row) throw new Error("Missing draft.");
    draft = row;
    clock = bookingNow;
    storage = createMemoryAdminObjectStorage();
    queries.length = 0;
  });
  function actions(
    session: Session | null = fixture.operator,
    overrides: Partial<PlanBackgroundDependencies> = {},
  ) {
    return createPlanBackgroundActions({
      database: database.db,
      getSession: async () => session,
      now: () => clock,
      storage,
      logError,
      ...overrides,
    });
  }
  function createInput(overrides: Record<string, unknown> = {}) {
    return {
      floorId: fixture.floorId,
      expectedDraftId: draft.id,
      size: 30,
      ...overrides,
    };
  }
  async function uploaded(
    options: {
      bytes?: Uint8Array;
      metadata?: Record<string, string>;
      contentType?: string;
    } = {},
  ) {
    const result = await actions().createPlanBackgroundUpload(createInput());
    if (!result.ok) throw new Error(`Upload setup failed: ${result.code}`);
    const pending = adminObjectKey({
      kind: "pending",
      uploadId: result.data.uploadId,
    });
    const key = adminObjectKey({
      kind: "plan-background",
      planId: draft.id,
      uploadId: result.data.uploadId,
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
      input: { floorId: fixture.floorId, uploadId: result.data.uploadId },
      target,
    };
  }
  async function row() {
    const [value] = await database.db
      .select()
      .from(floorPlans)
      .where(eq(floorPlans.id, draft.id));
    return value;
  }
  const get = (
    planId: string,
    session: Session | null = fixture.operator,
    objectStorage: typeof storage | null = storage,
  ) =>
    createPlanBackgroundQueries({
      database: database.db,
      requireSession: async () => {
        if (!session) throw new ActionError("UNAUTHENTICATED");
        return session;
      },
      storage: objectStorage,
      logError,
    }).getPlanBackground(planId);

  it("checks the session before malformed action input or storage", async () => {
    const head = vi.spyOn(storage, "head");
    expect(await actions(null).createPlanBackgroundUpload(null)).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(await actions(null).confirmPlanBackgroundUpload(null)).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(head).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });
  it.each([0, -1, 3 * 1024 * 1024 + 1, 0.5, NaN, Infinity])(
    "rejects invalid expected bytes %s before SQL",
    async (size) => {
      expect(
        await actions().createPlanBackgroundUpload(createInput({ size })),
      ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
      expect(queries).toEqual([]);
    },
  );
  it("rejects client authority, an absent draft ID and malformed UUIDs", async () => {
    for (const extra of [
      { userId: fixture.operator.userId },
      { expectedDraftId: undefined },
      { floorId: "bad" },
      { key: "pending/other" },
    ])
      expect(
        await actions().createPlanBackgroundUpload(createInput(extra)),
      ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(queries).toEqual([]);
  });
  it("issues only an exact five-minute WebP PUT bound to actor, floor and draft generation", async () => {
    const result = await actions().createPlanBackgroundUpload(
      createInput({
        floorId: fixture.floorId.toUpperCase(),
        expectedDraftId: draft.id.toUpperCase(),
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.data).sort()).toEqual([
      "planId",
      "uploadId",
      "url",
    ]);
    expect(result.data.planId).toBe(draft.id);
    expect(
      storage.uploads.get(
        adminObjectKey({ kind: "pending", uploadId: result.data.uploadId }),
      ),
    ).toEqual({
      contentType: "image/webp",
      contentLength: 30,
      expiresIn: 300,
      metadata: {
        purpose: "plan-background",
        "uploader-id": fixture.operator.userId,
        "floor-id": fixture.floorId,
        "plan-id": draft.id,
        "expected-size": "30",
        "expires-at": "2026-10-07T03:15:00.000Z",
      },
    });
    expect(await row()).toEqual(draft);
  });
  it("conceals foreign branches and nonstaff before resolving storage", async () => {
    for (const session of [fixture.person, fixture.otherOperator])
      expect(
        await actions(session, { storage: null }).createPlanBackgroundUpload(
          createInput(),
        ),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
  });
  it("enforces configured plan.edit and returns only an allowlisted disabled message", async () => {
    expect(
      await actions(fixture.operator, {
        storage: null,
      }).createPlanBackgroundUpload(createInput()),
    ).toEqual({ ok: false, code: "FORBIDDEN", message: "files_disabled" });
    await database.db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "operator",
      permissions: [],
      limits: {},
    });
    expect(await actions().createPlanBackgroundUpload(createInput())).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(
      await actions().confirmPlanBackgroundUpload({
        floorId: fixture.floorId,
        uploadId: crypto.randomUUID(),
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });
  it("rejects an absent draft and stale expected generations without issuing a URL", async () => {
    expect(
      await actions().createPlanBackgroundUpload(
        createInput({ expectedDraftId: crypto.randomUUID() }),
      ),
    ).toEqual({ ok: false, code: "STALE" });
    await database.db
      .update(floorPlans)
      .set({ status: "archived" })
      .where(eq(floorPlans.id, draft.id));
    expect(await actions().createPlanBackgroundUpload(createInput())).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(storage.uploads.size).toBe(0);
  });
  it("changes only background_image, preserves revision/document/attribution and returns no private keys", async () => {
    const upload = await uploaded();
    queries.length = 0;
    const result = await actions().confirmPlanBackgroundUpload(upload.input);
    expect(result).toEqual({
      ok: true,
      data: {
        uploadId: upload.input.uploadId,
        planId: draft.id,
        width: 640,
        height: 480,
      },
    });
    expect(await row()).toEqual({ ...draft, backgroundImage: upload.key });
    expect(await storage.head(upload.pending)).toBeNull();
    expect(await storage.head(upload.key)).toMatchObject({ size: 30 });
    const floorLock = queries.findIndex((query) =>
      /from "floors".*for share/i.test(query),
    );
    const draftLock = queries.findIndex((query) =>
      /from "floor_plans".*for update/i.test(query),
    );
    expect(floorLock).toBeGreaterThanOrEqual(0);
    expect(draftLock).toBeGreaterThan(floorLock);
    expect(
      queries.filter((query) => /^update "floor_plans"/i.test(query)),
    ).toEqual([
      expect.stringMatching(
        /set "background_image" = .*"status" = .*returning/i,
      ),
    ]);
  });
  it.each<Record<string, string>>([
    { purpose: "space-photo" },
    { "uploader-id": "00000000-0000-4000-8000-000000000001" },
    { "floor-id": "00000000-0000-4000-8000-000000000001" },
    { "expected-size": "30x" },
    { "expires-at": "bad" },
  ])(
    "rejects untrusted binding %j without deleting any object",
    async (metadata) => {
      const upload = await uploaded({ metadata });
      const remove = vi.spyOn(storage, "remove");
      const copy = vi.spyOn(storage, "copy");
      expect(await actions().confirmPlanBackgroundUpload(upload.input)).toEqual(
        { ok: false, code: "NOT_FOUND" },
      );
      expect(remove).not.toHaveBeenCalled();
      expect(copy).not.toHaveBeenCalled();
      expect(await row()).toEqual(draft);
    },
  );
  it("rejects a different or replaced draft generation and leaves its pending file alone", async () => {
    const upload = await uploaded({
      metadata: { "plan-id": crypto.randomUUID() },
    });
    expect(await actions().confirmPlanBackgroundUpload(upload.input)).toEqual({
      ok: false,
      code: "STALE",
    });
    expect(await storage.head(upload.pending)).not.toBeNull();
  });
  it("cleans only the owned expired pending file at the exact five-minute boundary", async () => {
    const upload = await uploaded();
    clock = new Date(bookingNow.getTime() + 300000);
    expect(await actions().confirmPlanBackgroundUpload(upload.input)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(await storage.head(upload.pending)).toBeNull();
    expect(await storage.head(upload.key)).toBeNull();
  });
  it.each([
    { bytes: webp(4097, 10) },
    { bytes: Buffer.from("not an image") },
    { bytes: webp().subarray(0, 20) },
    { contentType: "image/png" },
    { bytes: Buffer.alloc(3 * 1024 * 1024 + 1) },
    { metadata: { "expected-size": "31" } },
  ])(
    "rejects invalid image data and removes only its owned pending object %#",
    async (options) => {
      const upload = await uploaded(options);
      expect(await actions().confirmPlanBackgroundUpload(upload.input)).toEqual(
        { ok: false, code: "INVALID_INPUT" },
      );
      expect(await storage.head(upload.pending)).toBeNull();
      expect(await storage.head(upload.key)).toBeNull();
      expect(await row()).toEqual(draft);
    },
  );
  it("accepts the 4096px boundary and uses the exact verified ETag for copy", async () => {
    const upload = await uploaded({ bytes: webp(4096, 10) });
    const head = await storage.head(upload.pending);
    const copy = vi.spyOn(storage, "copy");
    expect(
      await actions().confirmPlanBackgroundUpload(upload.input),
    ).toMatchObject({ ok: true, data: { width: 4096, height: 10 } });
    expect(copy).toHaveBeenCalledExactlyOnceWith(upload.pending, upload.key, {
      sourceEtag: head?.etag,
      ifAbsent: true,
    });
  });
  it("never copies a PUT replay after header verification", async () => {
    const upload = await uploaded();
    const copy = storage.copy.bind(storage);
    vi.spyOn(storage, "copy").mockImplementation(async (from, to, options) => {
      storage.put(from, webp(200, 100), { metadata: upload.target.metadata });
      return copy(from, to, options);
    });
    expect(await actions().confirmPlanBackgroundUpload(upload.input)).toEqual({
      ok: false,
      code: "STALE",
    });
    expect(await storage.head(upload.key)).toBeNull();
    expect(await row()).toEqual(draft);
  });
  it("is idempotent after pending cleanup and expiry without copying again", async () => {
    const upload = await uploaded();
    const first = await actions().confirmPlanBackgroundUpload(upload.input);
    const copy = vi.spyOn(storage, "copy");
    clock = new Date(bookingNow.getTime() + 3600000);
    expect(await actions().confirmPlanBackgroundUpload(upload.input)).toEqual(
      first,
    );
    expect(copy).not.toHaveBeenCalled();
    expect(await storage.head(upload.key)).not.toBeNull();
  });
  it("does not let a copy loser connect or remove a winner's uncommitted object", async () => {
    const upload = await uploaded();
    storage.put(upload.key, webp(), { metadata: upload.target.metadata });
    const remove = vi.spyOn(storage, "remove");
    expect(await actions().confirmPlanBackgroundUpload(upload.input)).toEqual({
      ok: false,
      code: "STALE",
    });
    expect(await row()).toEqual(draft);
    expect(remove).not.toHaveBeenCalled();
    expect(await storage.head(upload.key)).not.toBeNull();
  });
  it("lets a copy loser succeed only when the same final object is already committed", async () => {
    const upload = await uploaded();
    const copy = storage.copy.bind(storage);
    vi.spyOn(storage, "copy").mockImplementation(async (from, to, options) => {
      await copy(from, to, options);
      await database.db
        .update(floorPlans)
        .set({ backgroundImage: to })
        .where(eq(floorPlans.id, draft.id));
      return "exists";
    });
    expect(
      await actions().confirmPlanBackgroundUpload(upload.input),
    ).toMatchObject({ ok: true });
    expect(await storage.head(upload.key)).not.toBeNull();
  });
  it("serializes two actual concurrent confirms without letting the loser delete the winner", async () => {
    const upload = await uploaded();
    const copy = storage.copy.bind(storage);
    let release: () => void = () => {
      throw new Error("Missing gate.");
    };
    let copied: () => void = () => {
      throw new Error("Missing gate.");
    };
    const copyStarted = new Promise<void>((resolve) => {
      copied = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(storage, "copy").mockImplementation(async (...args) => {
      const result = await copy(...args);
      if (result === "created") {
        copied();
        await resume;
      }
      return result;
    });
    const first = actions().confirmPlanBackgroundUpload(upload.input);
    await copyStarted;
    try {
      expect(await actions().confirmPlanBackgroundUpload(upload.input)).toEqual(
        { ok: false, code: "STALE" },
      );
      expect(await storage.head(upload.key)).not.toBeNull();
      expect(await row()).toEqual(draft);
    } finally {
      release();
    }
    expect(await first).toMatchObject({ ok: true });
    expect((await row())?.backgroundImage).toBe(upload.key);
    expect(
      await actions().confirmPlanBackgroundUpload(upload.input),
    ).toMatchObject({ ok: true });
  });
  it.each(["draft snapshot", "range missing", "range network"] as const)(
    "recovers only proven successful duplicate confirmation after %s races with pending cleanup",
    async (pauseAt) => {
      const upload = await uploaded();
      let reached: () => void = () => {
        throw new Error("Missing gate.");
      };
      let release: () => void = () => {
        throw new Error("Missing gate.");
      };
      const paused = new Promise<void>((resolve) => {
        reached = resolve;
      });
      const resume = new Promise<void>((resolve) => {
        release = resolve;
      });
      if (pauseAt === "draft snapshot") {
        const read = backgroundDal.readBackgroundDraft;
        vi.spyOn(backgroundDal, "readBackgroundDraft").mockImplementationOnce(
          async (...args) => {
            const snapshot = await read(...args);
            reached();
            await resume;
            return snapshot;
          },
        );
      } else {
        const range = storage.readRange.bind(storage);
        vi.spyOn(storage, "readRange").mockImplementationOnce(
          async (...args) => {
            reached();
            await resume;
            if (pauseAt === "range network")
              throw new Error("unrelated network failure");
            return range(...args);
          },
        );
      }
      const update = vi.spyOn(backgroundDal, "updatePlanBackground");
      const first = actions().confirmPlanBackgroundUpload(upload.input);
      await paused;
      const second = await actions()
        .confirmPlanBackgroundUpload(upload.input)
        .finally(release);
      expect(second).toMatchObject({ ok: true });
      expect(await first).toEqual(
        pauseAt === "range network" ? { ok: false, code: "INTERNAL" } : second,
      );
      expect(update).toHaveBeenCalledTimes(1);
      expect((await row())?.backgroundImage).toBe(upload.key);
      expect(await storage.head(upload.key)).not.toBeNull();
      expect(await storage.head(upload.pending)).toBeNull();
    },
  );
  it("does not adopt an unlinked final when pending is already absent", async () => {
    const upload = await uploaded();
    storage.put(upload.key, webp(), { metadata: upload.target.metadata });
    await storage.remove(upload.pending);
    const remove = vi.spyOn(storage, "remove");
    expect(await actions().confirmPlanBackgroundUpload(upload.input)).toEqual({
      ok: false,
      code: "STALE",
    });
    expect(await row()).toEqual(draft);
    expect(remove).not.toHaveBeenCalled();
    expect(await storage.head(upload.key)).not.toBeNull();
  });
  it("rejects expiration during copy under the draft lock and cleans only its own final", async () => {
    const upload = await uploaded();
    const copy = storage.copy.bind(storage);
    vi.spyOn(storage, "copy").mockImplementationOnce(async (...args) => {
      const result = await copy(...args);
      clock = new Date(bookingNow.getTime() + 300000);
      return result;
    });
    expect(await actions().confirmPlanBackgroundUpload(upload.input)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(await storage.head(upload.key)).toBeNull();
    expect(await row()).toEqual(draft);
  });
  it("treats a zero-row conditional draft update as stale and removes only the newly copied final", async () => {
    const upload = await uploaded();
    vi.spyOn(backgroundDal, "updatePlanBackground").mockResolvedValueOnce(null);
    expect(await actions().confirmPlanBackgroundUpload(upload.input)).toEqual({
      ok: false,
      code: "STALE",
    });
    expect(await storage.head(upload.key)).toBeNull();
    expect(await row()).toEqual(draft);
  });
  it("checks disabled confirm and missing pending without changing the draft", async () => {
    const input = { floorId: fixture.floorId, uploadId: crypto.randomUUID() };
    expect(
      await actions(fixture.operator, {
        storage: null,
      }).confirmPlanBackgroundUpload(input),
    ).toEqual({ ok: false, code: "FORBIDDEN", message: "files_disabled" });
    expect(await actions().confirmPlanBackgroundUpload(input)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await row()).toEqual(draft);
  });
  it("rolls back and cleans its own final after permission revocation before the locked recheck", async () => {
    const upload = await uploaded();
    const copy = storage.copy.bind(storage);
    vi.spyOn(storage, "copy").mockImplementation(async (from, to, options) => {
      const result = await copy(from, to, options);
      await database.db
        .delete(branchStaff)
        .where(eq(branchStaff.userId, fixture.operator.userId));
      return result;
    });
    expect(await actions().confirmPlanBackgroundUpload(upload.input)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await storage.head(upload.key)).toBeNull();
    expect(await row()).toEqual(draft);
  });
  it("rejects a published/replaced draft after copy without touching its newer generation", async () => {
    const upload = await uploaded();
    const copy = storage.copy.bind(storage);
    let newer: typeof draft | undefined;
    vi.spyOn(storage, "copy").mockImplementation(async (from, to, options) => {
      const result = await copy(from, to, options);
      await database.db
        .update(floorPlans)
        .set({ status: "archived" })
        .where(eq(floorPlans.id, draft.id));
      [newer] = await database.db
        .insert(floorPlans)
        .values({
          floorId: draft.floorId,
          version: 2,
          status: "draft",
          document,
          createdBy: fixture.operator.userId,
        })
        .returning();
      return result;
    });
    expect(await actions().confirmPlanBackgroundUpload(upload.input)).toEqual({
      ok: false,
      code: "STALE",
    });
    expect(await storage.head(upload.key)).toBeNull();
    expect(newer?.backgroundImage).toBeNull();
  });
  it("rolls back a late DB failure, cleans the copied final, and does not log raw errors", async () => {
    const upload = await uploaded();
    const update = backgroundDal.updatePlanBackground;
    vi.spyOn(backgroundDal, "updatePlanBackground").mockImplementation(
      async (input, db) => {
        await update(input, db);
        throw new Error("secret-bucket-and-token");
      },
    );
    expect(await actions().confirmPlanBackgroundUpload(upload.input)).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(await row()).toEqual(draft);
    expect(await storage.head(upload.key)).toBeNull();
    expect(logError).toHaveBeenCalledWith("Plan background operation failed.");
    expect(JSON.stringify(logError.mock.calls)).not.toContain("secret-bucket");
  });
  it("preserves an object when the COMMIT response is lost after successful DB linkage", async () => {
    const upload = await uploaded();
    const transaction = database.db.transaction.bind(database.db);
    vi.spyOn(database.db, "transaction").mockImplementationOnce(
      async (callback) => {
        await transaction(callback);
        throw new Error("lost commit acknowledgement");
      },
    );
    expect(await actions().confirmPlanBackgroundUpload(upload.input)).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect((await row())?.backgroundImage).toBe(upload.key);
    expect(await storage.head(upload.key)).not.toBeNull();
    expect(
      await actions().confirmPlanBackgroundUpload(upload.input),
    ).toMatchObject({ ok: true });
  });
  it("preserves ambiguous copy outcomes rather than deleting an unconfirmed winner", async () => {
    const upload = await uploaded();
    const copy = storage.copy.bind(storage);
    vi.spyOn(storage, "copy").mockImplementationOnce(async (...args) => {
      await copy(...args);
      throw new Error("lost copy response");
    });
    expect(await actions().confirmPlanBackgroundUpload(upload.input)).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(await storage.head(upload.key)).not.toBeNull();
    expect(await row()).toEqual(draft);
    expect(await actions().confirmPlanBackgroundUpload(upload.input)).toEqual({
      ok: false,
      code: "STALE",
    });
    expect(await storage.head(upload.key)).not.toBeNull();
  });
  it("keeps success when pending cleanup and its logger both fail", async () => {
    const upload = await uploaded();
    vi.spyOn(storage, "remove").mockRejectedValue(new Error("secret"));
    expect(
      await actions(fixture.operator, {
        logError: () => {
          throw new Error("logger");
        },
      }).confirmPlanBackgroundUpload(upload.input),
    ).toMatchObject({ ok: true });
    expect((await row())?.backgroundImage).toBe(upload.key);
    expect(await storage.head(upload.key)).not.toBeNull();
  });
  it("does not overwrite document autosave or remove prior version background objects", async () => {
    const first = await uploaded();
    await actions().confirmPlanBackgroundUpload(first.input);
    const second = await uploaded();
    await actions().confirmPlanBackgroundUpload(second.input);
    const saved = await createPlanEditorActions({
      database: database.db,
      getSession: async () => fixture.operator,
      now: () => bookingNow,
    }).saveFloorPlanDraft({
      floorId: draft.floorId,
      basePlanId: null,
      revision: draft.revision,
      document: { ...document, bounds: { w: 31000, h: 21000 } },
    });
    expect(saved.ok).toBe(true);
    expect(await row()).toMatchObject({
      backgroundImage: second.key,
      revision: 5,
      document: { bounds: { w: 31000, h: 21000 } },
    });
    expect(await storage.head(first.key)).not.toBeNull();
    expect(await storage.head(second.key)).not.toBeNull();
  });

  it("returns GET 401 before malformed IDs without querying storage or DB", async () => {
    const stream = vi.spyOn(storage, "readStream");
    const result = await get("not-a-uuid", null);
    expect(result.status).toBe(401);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(stream).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });
  it("conceals malformed, missing, no-image, nonstaff, denied and foreign plan backgrounds", async () => {
    const upload = await uploaded();
    await actions().confirmPlanBackgroundUpload(upload.input);
    const stream = vi.spyOn(storage, "readStream");
    expect((await get("bad")).status).toBe(404);
    expect((await get(crypto.randomUUID())).status).toBe(404);
    for (const session of [fixture.person, fixture.otherOperator])
      expect((await get(draft.id, session)).status).toBe(404);
    await database.db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "operator",
      permissions: [],
      limits: {},
    });
    expect((await get(draft.id)).status).toBe(404);
    await database.db
      .update(floorPlans)
      .set({ backgroundImage: null })
      .where(eq(floorPlans.id, draft.id));
    expect((await get(draft.id)).status).toBe(404);
    expect(stream).not.toHaveBeenCalled();
  });
  it.each(["draft", "published", "archived"] as const)(
    "streams only authorized %s background with private headers in [1,3] SQL",
    async (status) => {
      const upload = await uploaded();
      await actions().confirmPlanBackgroundUpload(upload.input);
      await database.db
        .update(floorPlans)
        .set({ status })
        .where(eq(floorPlans.id, draft.id));
      meter.start();
      const result = await get(draft.id.toUpperCase());
      const measurement = meter.stop();
      expect(measurement.perStage).toEqual([1, 3]);
      expect(result.status).toBe(200);
      expect(result.headers.get("content-type")).toBe("image/webp");
      expect(result.headers.get("cache-control")).toBe("private, no-store");
      expect(result.headers.get("x-content-type-options")).toBe("nosniff");
      expect(Buffer.from(await result.arrayBuffer())).toEqual(webp());
    },
  );
  it("allows an authorized restored plan to reference the previous generation's same-floor image", async () => {
    const upload = await uploaded();
    await actions().confirmPlanBackgroundUpload(upload.input);
    await database.db
      .update(floorPlans)
      .set({ status: "archived" })
      .where(eq(floorPlans.id, draft.id));
    const [restored] = await database.db
      .insert(floorPlans)
      .values({
        floorId: draft.floorId,
        version: 2,
        status: "draft",
        document,
        backgroundImage: upload.key,
        createdBy: fixture.operator.userId,
      })
      .returning();
    if (!restored) throw new Error("Missing restored draft.");
    expect((await get(restored.id)).status).toBe(200);
  });
  it.each([
    "private.webp",
    "../secret",
    "https://bucket.invalid/image",
    "pending/00000000-0000-4000-8000-000000000001.webp",
    "space-photos/00000000-0000-4000-8000-000000000001.webp",
  ])("refuses a non-background database key %j", async (key) => {
    await database.db
      .update(floorPlans)
      .set({ backgroundImage: key })
      .where(eq(floorPlans.id, draft.id));
    const stream = vi.spyOn(storage, "readStream");
    expect((await get(draft.id)).status).toBe(404);
    expect(stream).not.toHaveBeenCalled();
  });
  it("returns private 404 for disabled or missing storage and fixed 500 for backend failures", async () => {
    const upload = await uploaded();
    await actions().confirmPlanBackgroundUpload(upload.input);
    expect((await get(draft.id, fixture.operator, null)).status).toBe(404);
    await storage.remove(upload.key);
    expect((await get(draft.id)).status).toBe(404);
    vi.spyOn(storage, "readStream").mockRejectedValue(
      new Error("signed secret URL"),
    );
    const result = await get(draft.id);
    expect(result.status).toBe(500);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(await result.text()).toBe("");
    expect(logError).toHaveBeenCalledWith("Plan background read failed.");
  });
  it("adds an injectable adminFilesEnabled flag without expanding editor [4,2] SQL or exposing storage keys", async () => {
    const enabled = vi.fn(() => true);
    meter.start();
    const result = await createPlanEditorQueries({
      database: database.db,
      requireSession: async () => fixture.operator,
      adminFilesEnabled: enabled,
      now: () => bookingNow,
    }).getPlanEditor({ branchId: fixture.branchId, floorId: fixture.floorId });
    expect(meter.stop().perStage).toEqual([4, 2]);
    expect(result.adminFilesEnabled).toBe(true);
    expect(enabled).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain("backgroundImage");
  });
});
