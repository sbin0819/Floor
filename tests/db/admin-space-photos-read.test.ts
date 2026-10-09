import { and, eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createAdminSpaceQueries } from "@/features/admin/space-detail-query-factory";
import { createSpacePhotoQueries } from "@/features/admin/photo-query-factory";
import { ActionError } from "@/lib/actions/result";
import * as detailDal from "@/lib/dal/admin-space-read";
import * as teamDal from "@/lib/dal/teams-read";
import {
  accessGrants,
  bookingParticipants,
  branchStaff,
  floors,
  roleSettings,
  spacePhotos,
} from "@/lib/db/schema";
import { createMemoryAdminObjectStorage } from "@/lib/storage/admin-memory";
import {
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("space detail projection and private photo files", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  let storage: ReturnType<typeof createMemoryAdminObjectStorage>;
  let meter: ReturnType<typeof createQueryMeter>;
  beforeAll(async () => {
    database = await createTestDatabase();
    meter = createQueryMeter(database.client);
  });
  beforeEach(async () => {
    actors = await seedBookingActors(database);
    storage = createMemoryAdminObjectStorage();
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    meter.restore();
    await database.client.close();
  });
  const deps = (session = actors.operator) => ({
    database: database.db,
    requireSession: async () => session,
  });
  const details = (session = actors.operator, filesEnabled = false) =>
    createAdminSpaceQueries({ ...deps(session), filesEnabled });
  const photoQuery = (session = actors.person) =>
    createSpacePhotoQueries({ ...deps(session), storage });
  async function photo(
    spaceId = actors.publicSpaceId,
    sortOrder = 0,
    overrides: Partial<typeof spacePhotos.$inferInsert> = {},
  ) {
    const id = crypto.randomUUID();
    const [row] = await database.db
      .insert(spacePhotos)
      .values({
        id,
        spaceId,
        sortOrder,
        path: `/api/space-photos/${id}.webp`,
        alt: "회의실의 책상과 모니터",
        ...overrides,
      })
      .returning();
    storage.put(`space-photos/${row!.id}.webp`, new Uint8Array([1, 2, 3, 4]));
    return row!;
  }
  const detail = (
    options?: Parameters<ReturnType<typeof details>["getAdminSpace"]>[3],
  ) =>
    details().getAdminSpace(
      actors.branchId,
      actors.floorId,
      actors.publicSpaceId,
      options,
    );

  it("checks the session before malformed IDs, flags or SQL", async () => {
    const subject = createAdminSpaceQueries({
      ...deps(),
      requireSession: async () => {
        throw new ActionError("UNAUTHENTICATED");
      },
    });
    meter.start();
    await expect(
      subject.getAdminSpace("bad", "bad", "bad"),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(meter.stop().statements).toBe(0);
  });
  it.each(["branch", "floor", "space"])(
    "rejects an invalid %s UUID before SQL",
    async (field) => {
      meter.start();
      await expect(
        details().getAdminSpace(
          field === "branch" ? "bad" : actors.branchId,
          field === "floor" ? "bad" : actors.floorId,
          field === "space" ? "bad" : actors.publicSpaceId,
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(meter.stop().statements).toBe(0);
    },
  );
  it.each(["branch", "floor", "space", "desk", "missing"])(
    "checks actual parent relationships for %s without reading names, photos or team search",
    async (kind) => {
      const read = vi.spyOn(detailDal, "readAdminSpaceDetail"),
        search = vi.spyOn(teamDal, "searchTeams");
      await expect(
        details().getAdminSpace(
          kind === "branch" ? actors.otherBranchId : actors.branchId,
          kind === "floor" ? actors.otherFloorId : actors.floorId,
          kind === "space"
            ? actors.otherSpaceId
            : kind === "desk"
              ? actors.deskId
              : kind === "missing"
                ? crypto.randomUUID()
                : actors.publicSpaceId,
          { tab: "access", team: "그로스" },
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(read).not.toHaveBeenCalled();
      expect(search).not.toHaveBeenCalled();
    },
  );
  it.each(["person", "otherOperator"] as const)(
    "does not read private detail or photos for %s",
    async (actor) => {
      const run = vi.spyOn(database.client, "query"),
        read = vi.spyOn(detailDal, "readAdminSpaceDetail");
      await expect(
        details(actors[actor]).getAdminSpace(
          actors.branchId,
          actors.floorId,
          actors.publicSpaceId,
        ),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(read).not.toHaveBeenCalled();
      expect(run.mock.calls.map(([text]) => text).join(" ")).not.toMatch(
        /space_photos|"spaces"\."name"|"floors"\."name"|"branches"\."name"/,
      );
    },
  );
  it("requires either management permission before the detail SQL, while plan.edit-only photos remain read-only", async () => {
    await photo();
    await database.db
      .insert(roleSettings)
      .values({ branchId: actors.branchId, role: "operator", permissions: [] });
    const read = vi.spyOn(detailDal, "readAdminSpaceDetail");
    await expect(detail({ tab: "photos" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(read).not.toHaveBeenCalled();
    await database.db
      .update(roleSettings)
      .set({ permissions: ["plan.edit"] })
      .where(eq(roleSettings.branchId, actors.branchId));
    const view = await detail({ tab: "photos" });
    expect(view.permissions).toEqual({ manageSpaces: false, editAccess: true });
    expect(view.photos).toHaveLength(1);
    await database.db
      .update(roleSettings)
      .set({ permissions: ["space.manage"] })
      .where(eq(roleSettings.branchId, actors.branchId));
    expect((await detail()).permissions).toEqual({
      manageSpaces: true,
      editAccess: false,
    });
  });
  it("returns only the selected space plus ordered photos and existing form/access contracts, without per-photo storage requests", async () => {
    const last = await photo(actors.publicSpaceId, 1),
      first = await photo(actors.publicSpaceId, 0, {
        path: "/seed/photos/meeting-small-sage.webp",
        alt: "시드 사진",
      });
    const secret = await photo(actors.secondSpaceId, 0, {
      alt: "다른 공간 비밀",
    });
    await database.db.insert(accessGrants).values({
      targetType: "space",
      targetId: actors.publicSpaceId,
      teamId: actors.teamId,
    });
    const result = await details(actors.operator, true).getAdminSpace(
      actors.branchId.toUpperCase(),
      actors.floorId.toUpperCase(),
      actors.publicSpaceId.toUpperCase(),
    );
    expect(result).toMatchObject({
      branch: { id: actors.branchId, name: "강남점" },
      floor: { id: actors.floorId, name: "7F" },
      space: {
        id: actors.publicSpaceId,
        name: "회의실 B",
        type: "meeting_room",
        archivedAt: null,
        allowedTeams: [{ id: actors.teamId }],
      },
      filesEnabled: true,
      teamSearch: { query: "", valid: false, results: [] },
    });
    expect(result.photos).toEqual(
      [first, last].map(({ id, path, alt, sortOrder }) => ({
        id,
        path,
        alt,
        sortOrder,
      })),
    );
    expect(Object.keys(result).sort()).toEqual([
      "branch",
      "filesEnabled",
      "floor",
      "permissions",
      "photos",
      "space",
      "teamSearch",
    ]);
    expect(Object.keys(result.photos[0]!).sort()).toEqual([
      "alt",
      "id",
      "path",
      "sortOrder",
    ]);
    expect(JSON.stringify(result)).not.toMatch(
      /email|bookingRules|createdAt|coverPhoto|다른 공간 비밀/,
    );
    expect(JSON.stringify(result)).not.toContain(secret.path);
  });
  it("uses [4,1], or [4,2] for valid access-tab team searches, with any photo count", async () => {
    for (const count of [0, 8]) {
      if (count)
        await database.db.insert(spacePhotos).values(
          Array.from({ length: count }, (_, sortOrder) => ({
            spaceId: actors.publicSpaceId,
            sortOrder,
            path: `/seed/photos/p-${sortOrder}.webp`,
            alt: "사진",
          })),
        );
      for (const tab of ["info", "photos", "access"] as const) {
        meter.start();
        const result = await detail({ tab, team: "그로스" });
        expect(meter.stop()).toEqual(
          tab === "access"
            ? { stages: 2, statements: 6, perStage: [4, 2] }
            : { stages: 2, statements: 5, perStage: [4, 1] },
        );
        expect(result.photos).toHaveLength(count);
        expect(result.teamSearch.valid).toBe(tab === "access");
      }
    }
    const search = vi.spyOn(teamDal, "searchTeams");
    for (const team of ["한", "x".repeat(41), "ab\0", ["그로스"]])
      await detail({ tab: "access", team });
    expect(search).not.toHaveBeenCalled();
  });
  it("retains archived space detail and desk-area counts for operators", async () => {
    await photo(actors.archivedSpaceId);
    const archived = await details().getAdminSpace(
      actors.branchId,
      actors.floorId,
      actors.archivedSpaceId,
      { tab: "photos" },
    );
    expect(archived.space.archivedAt).toBe(bookingNow.toISOString());
    expect(archived.photos).toHaveLength(1);
    const area = await details().getAdminSpace(
      actors.branchId,
      actors.floorId,
      actors.deskAreaId,
    );
    expect(area.space.deskCount).toBe(2);
  });
  it("rechecks assigned staff in detail SQL if membership changes after the identity read", async () => {
    const original = detailDal.readAdminSpaceDetail;
    vi.spyOn(detailDal, "readAdminSpaceDetail").mockImplementationOnce(
      async (scope, db) => {
        await database.db
          .delete(branchStaff)
          .where(
            and(
              eq(branchStaff.branchId, actors.branchId),
              eq(branchStaff.userId, actors.operator.userId),
            ),
          );
        return original(scope, db);
      },
    );
    await expect(detail()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("returns 401 without SQL or storage for an unauthenticated GET", async () => {
    const stream = vi.spyOn(storage, "readStream");
    meter.start();
    const result = await createSpacePhotoQueries({
      database: database.db,
      storage,
      requireSession: async () => {
        throw new ActionError("UNAUTHENTICATED");
      },
    }).getSpacePhoto("10000000-0000-4000-8000-000000000001.webp");
    expect(result.status).toBe(401);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(meter.stop().statements).toBe(0);
    expect(stream).not.toHaveBeenCalled();
  });
  it("rejects uppercase UUIDs, wrong extensions, separators and suffixes before SQL or storage", async () => {
    const stream = vi.spyOn(storage, "readStream"),
      id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    meter.start();
    for (const file of [
      `${id.toUpperCase()}.webp`,
      `${id}.png`,
      `${id}.WEBP`,
      `../${id}.webp`,
      `${id}.webp?x=1`,
      `${id}.webp\n`,
      `${id}.webp.webp`,
      "bad.webp",
      `${id}%2f.webp`,
    ])
      expect((await photoQuery().getSpacePhoto(file)).status).toBe(404);
    expect(meter.stop().statements).toBe(0);
    expect(stream).not.toHaveBeenCalled();
  });
  it("requires both exact photo id and exact path, not a matching filename from another row or namespace", async () => {
    const stream = vi.spyOn(storage, "readStream");
    const row = await photo(actors.publicSpaceId, 0, {
      path: "/seed/photos/original.webp",
    });
    expect((await photoQuery().getSpacePhoto(`${row.id}.webp`)).status).toBe(
      404,
    );
    await database.db
      .update(spacePhotos)
      .set({ path: `/api/space-photos/${crypto.randomUUID()}.webp` })
      .where(eq(spacePhotos.id, row.id));
    expect((await photoQuery().getSpacePhoto(`${row.id}.webp`)).status).toBe(
      404,
    );
    expect(
      (await photoQuery().getSpacePhoto(`${crypto.randomUUID()}.webp`)).status,
    ).toBe(404);
    expect(stream).not.toHaveBeenCalled();
  });
  it("streams only after access is approved, with immutable private WebP headers and one [3] SQL stage", async () => {
    const row = await photo(),
      read = vi.spyOn(storage, "readStream"),
      head = vi.spyOn(storage, "head");
    meter.start();
    const result = await photoQuery().getSpacePhoto(`${row.id}.webp`);
    expect(meter.stop()).toEqual({ stages: 1, statements: 3, perStage: [3] });
    expect(result.status).toBe(200);
    expect(new Uint8Array(await result.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3, 4]),
    );
    expect(result.headers.get("content-type")).toBe("image/webp");
    expect(result.headers.get("cache-control")).toBe(
      "private, max-age=31536000, immutable",
    );
    expect(result.headers.get("x-content-type-options")).toBe("nosniff");
    expect(read).toHaveBeenCalledExactlyOnceWith(`space-photos/${row.id}.webp`);
    expect(head).not.toHaveBeenCalled();
  });
  it("checks floor AND space team access rather than accepting separate memberships across their intersection", async () => {
    const row = await photo(actors.restrictedSpaceId);
    const read = vi.spyOn(storage, "readStream");
    expect(
      (await photoQuery(actors.person).getSpacePhoto(`${row.id}.webp`)).status,
    ).toBe(404);
    expect(read).not.toHaveBeenCalled();
    expect(
      (await photoQuery(actors.member).getSpacePhoto(`${row.id}.webp`)).status,
    ).toBe(200);
    await database.db
      .update(floors)
      .set({ access: "teams" })
      .where(eq(floors.id, actors.floorId));
    await database.db.insert(accessGrants).values({
      targetType: "floor",
      targetId: actors.floorId,
      teamId: actors.otherTeamId,
    });
    expect(
      (await photoQuery(actors.member).getSpacePhoto(`${row.id}.webp`)).status,
    ).toBe(404);
  });
  it("allows an old cancelled booking owner, never a participant or another team member by that exception", async () => {
    const row = await photo(actors.closedSpaceId),
      booking = await insertFixtureBooking(database, actors, {
        spaceId: actors.closedSpaceId,
        userId: actors.person.userId,
        during: bookingRange("10:00", "11:00", "2026-08-01"),
        status: "cancelled",
        cancelledAt: bookingNow,
        cancelledBy: actors.person.userId,
      });
    await database.db.insert(bookingParticipants).values({
      bookingId: booking.id,
      userId: actors.member.userId,
      createdAt: bookingNow,
    });
    expect(
      (await photoQuery(actors.person).getSpacePhoto(`${row.id}.webp`)).status,
    ).toBe(200);
    for (const actor of [actors.member, actors.admin, actors.stranger])
      expect(
        (await photoQuery(actor).getSpacePhoto(`${row.id}.webp`)).status,
      ).toBe(404);
  });
  it("does not generalize a booking for one space into access to another space", async () => {
    const row = await photo(actors.closedSpaceId);
    await insertFixtureBooking(database, actors, {
      userId: actors.person.userId,
    });
    expect((await photoQuery().getSpacePhoto(`${row.id}.webp`)).status).toBe(
      404,
    );
  });
  it("hides archived photos from ordinary browsing but keeps owner and own-staff access", async () => {
    const row = await photo(actors.archivedSpaceId);
    expect((await photoQuery().getSpacePhoto(`${row.id}.webp`)).status).toBe(
      404,
    );
    expect(
      (await photoQuery(actors.operator).getSpacePhoto(`${row.id}.webp`))
        .status,
    ).toBe(200);
    expect(
      (await photoQuery(actors.otherOperator).getSpacePhoto(`${row.id}.webp`))
        .status,
    ).toBe(404);
    await insertFixtureBooking(database, actors, {
      spaceId: actors.archivedSpaceId,
      userId: actors.person.userId,
    });
    expect((await photoQuery().getSpacePhoto(`${row.id}.webp`)).status).toBe(
      200,
    );
  });
  it("returns no-store 404 when storage is disabled, the row is deleted or the object is absent", async () => {
    const row = await photo();
    const disabled = await createSpacePhotoQueries({
      ...deps(actors.person),
      storage: null,
    }).getSpacePhoto(`${row.id}.webp`);
    expect(disabled.status).toBe(404);
    expect(disabled.headers.get("cache-control")).toBe("private, no-store");
    await storage.remove(`space-photos/${row.id}.webp`);
    const missing = await photoQuery().getSpacePhoto(`${row.id}.webp`);
    expect(missing.status).toBe(404);
    expect(missing.headers.get("cache-control")).toBe("private, no-store");
    await database.db.delete(spacePhotos).where(eq(spacePhotos.id, row.id));
    const deleted = await photoQuery().getSpacePhoto(`${row.id}.webp`);
    expect(deleted.status).toBe(404);
  });
  it("logs a fixed safe message for storage failures without echoing keys, signed URLs or credentials", async () => {
    const row = await photo(),
      log = vi.fn();
    vi.spyOn(storage, "readStream").mockRejectedValue(
      new Error("https://private.invalid/?secret=do-not-log"),
    );
    const result = await createSpacePhotoQueries({
      ...deps(actors.person),
      storage,
      logError: log,
    }).getSpacePhoto(`${row.id}.webp`);
    expect(result.status).toBe(500);
    expect(await result.text()).toBe("");
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(log).toHaveBeenCalledExactlyOnceWith("Space photo read failed.");
  });
});
