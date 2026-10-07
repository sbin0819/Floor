import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
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
import { createAccessActions } from "@/features/admin/access-factory";
import type { AdminDependencies } from "@/features/admin/action-factory";
import { createBookingActions } from "@/features/bookings/create-booking-factory";
import type { Session } from "@/lib/auth/types";
import * as adminDal from "@/lib/dal/admin";
import { getFloorWithAccess } from "@/lib/dal/branches";
import { getSpaceForAccess } from "@/lib/dal/spaces";
import * as schema from "@/lib/db/schema";
import { accessGrants, bookings, roleSettings, spaces } from "@/lib/db/schema";
import { canAccess } from "@/lib/permissions/can-access";
import { loadPermissionContext } from "@/lib/permissions/context";
import { defaultPermissions } from "@/lib/permissions/defaults";
import { createMemoryRealtime } from "@/lib/realtime/memory";
import {
  bookingInput,
  bookingInstant,
  bookingNow,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("operator floor and space access actions", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.client.close();
  });
  beforeEach(async () => {
    fixture = await seedBookingActors(database);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  function actions(
    session: Session | null = fixture.operator,
    overrides: AdminDependencies = {},
  ) {
    return createAccessActions({
      database: database.db,
      getSession: async () => session,
      now: () => bookingNow,
      logError: vi.fn(),
      ...overrides,
    });
  }
  function floorInput(access: "everyone" | "teams" | "closed" = "teams") {
    return {
      floorId: fixture.floorId,
      access,
      teamIds: access === "teams" ? [fixture.teamId] : [],
    };
  }
  function spaceInput(
    access: "everyone" | "teams" | "closed" | null = "teams",
  ) {
    return {
      spaceId: fixture.publicSpaceId,
      access,
      teamIds: access === "teams" ? [fixture.teamId] : [],
    };
  }
  async function grants(targetType: "floor" | "space", targetId: string) {
    return database.db
      .select()
      .from(accessGrants)
      .where(
        and(
          eq(accessGrants.targetType, targetType),
          eq(accessGrants.targetId, targetId),
        ),
      )
      .orderBy(accessGrants.teamId);
  }
  async function allowed(session: Session, spaceId: string) {
    const [context, space] = await Promise.all([
      loadPermissionContext(session, fixture.branchId, database.db),
      getSpaceForAccess(spaceId, database.db),
    ]);
    if (!space) throw new Error("Expected fixture space.");
    return canAccess(context, space);
  }
  async function spaceSettings() {
    return (
      await adminDal.listAdminSpaces(
        { floorId: fixture.floorId, includeArchived: true, includeDesks: true },
        database.db,
      )
    ).map(({ id, access, allowedTeamIds }) => ({
      id,
      access,
      allowedTeamIds: [...allowedTeamIds].sort(),
    }));
  }

  it("reconciles floor grants, deduplicates UUID case, preserves retained rows and clears grants on everyone", async () => {
    const publish = vi.fn();
    const current = actions(fixture.operator, { publisher: { publish } });
    expect(
      await current.setFloorAccess({
        ...floorInput(),
        teamIds: [
          fixture.teamId,
          fixture.otherTeamId,
          fixture.teamId.toUpperCase(),
        ],
      }),
    ).toMatchObject({ ok: true });
    const initial = await grants("floor", fixture.floorId);
    expect(initial.map(({ teamId }) => teamId).sort()).toEqual(
      [fixture.teamId, fixture.otherTeamId].sort(),
    );
    expect(await current.setFloorAccess(floorInput())).toEqual({
      ok: true,
      data: { floorId: fixture.floorId, changedSpaces: [] },
    });
    expect(await grants("floor", fixture.floorId)).toEqual(
      initial.filter(({ teamId }) => teamId === fixture.teamId),
    );
    expect(await current.setFloorAccess(floorInput("everyone"))).toMatchObject({
      ok: true,
    });
    expect(await grants("floor", fixture.floorId)).toEqual([]);
    expect(
      await getFloorWithAccess(fixture.floorId, database.db),
    ).toMatchObject({
      access: "everyone",
      allowedTeamIds: [],
    });
    expect(publish).not.toHaveBeenCalled();
  });

  it("narrows all spaces including archived spaces and desks and reports exactly the changed rows", async () => {
    await database.db
      .update(spaces)
      .set({ access: "everyone" })
      .where(eq(spaces.id, fixture.publicSpaceId));
    await database.db
      .update(spaces)
      .set({ access: "everyone" })
      .where(eq(spaces.id, fixture.archivedSpaceId));
    await database.db
      .update(spaces)
      .set({ access: "teams" })
      .where(eq(spaces.id, fixture.secondSpaceId));
    await database.db
      .update(spaces)
      .set({ access: "teams" })
      .where(eq(spaces.id, fixture.deskId));
    await database.db.insert(accessGrants).values([
      {
        targetType: "space",
        targetId: fixture.secondSpaceId,
        teamId: fixture.teamId,
      },
      {
        targetType: "space",
        targetId: fixture.secondSpaceId,
        teamId: fixture.otherTeamId,
      },
      {
        targetType: "space",
        targetId: fixture.deskId,
        teamId: fixture.otherTeamId,
      },
    ]);
    const before = await adminDal.listAdminSpaces(
      { floorId: fixture.floorId, includeArchived: true, includeDesks: true },
      database.db,
    );
    const result = await actions().setFloorAccess(floorInput());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected floor access change.");
    expect(result.data.changedSpaces).toHaveLength(4);
    const expected = [
      { id: fixture.publicSpaceId, access: null },
      { id: fixture.archivedSpaceId, access: null },
      { id: fixture.secondSpaceId, access: "teams" },
      { id: fixture.deskId, access: "closed" },
    ];
    for (const change of expected) {
      const original = before.find(({ id }) => id === change.id);
      expect(result.data.changedSpaces).toContainEqual({
        ...change,
        name: original!.name,
      });
      expect(await getSpaceForAccess(change.id, database.db)).toMatchObject(
        change,
      );
    }
    expect(
      (await grants("space", fixture.secondSpaceId)).map(
        ({ teamId }) => teamId,
      ),
    ).toEqual([fixture.teamId]);
    expect(await grants("space", fixture.deskId)).toEqual([]);
    expect(
      await getSpaceForAccess(fixture.closedSpaceId, database.db),
    ).toMatchObject({ access: "closed" });
    expect(
      await getSpaceForAccess(fixture.deskAreaId, database.db),
    ).toMatchObject({ access: null });
    expect(await allowed(fixture.admin, fixture.secondSpaceId)).toBe(true);
    expect(await allowed(fixture.otherMember, fixture.secondSpaceId)).toBe(
      false,
    );
    expect(await allowed(fixture.person, fixture.publicSpaceId)).toBe(false);
  });

  it("closes an A-only room when the floor becomes B-only without granting it to B", async () => {
    const result = await actions().setFloorAccess({
      ...floorInput(),
      teamIds: [fixture.otherTeamId],
    });
    expect(result).toMatchObject({
      ok: true,
      data: {
        changedSpaces: [
          { id: fixture.restrictedSpaceId, name: "회의실 A", access: "closed" },
        ],
      },
    });
    expect(await grants("space", fixture.restrictedSpaceId)).toEqual([]);
    expect(await allowed(fixture.otherMember, fixture.publicSpaceId)).toBe(
      true,
    );
    expect(await allowed(fixture.otherMember, fixture.restrictedSpaceId)).toBe(
      false,
    );
    expect(await allowed(fixture.admin, fixture.restrictedSpaceId)).toBe(false);
  });

  it("preserves space settings while closed, rejects widening writes, and restores original access on reopening", async () => {
    const original = await spaceSettings();
    expect(await actions().setFloorAccess(floorInput("closed"))).toEqual({
      ok: true,
      data: { floorId: fixture.floorId, changedSpaces: [] },
    });
    expect(await spaceSettings()).toEqual(original);
    expect(await allowed(fixture.admin, fixture.restrictedSpaceId)).toBe(false);
    for (const access of ["everyone", "teams"] as const)
      expect(await actions().setSpaceAccess(spaceInput(access))).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
    expect(await spaceSettings()).toEqual(original);
    expect(
      await actions().setFloorAccess(floorInput("everyone")),
    ).toMatchObject({ ok: true });
    expect(await spaceSettings()).toEqual(original);
    expect(await allowed(fixture.admin, fixture.restrictedSpaceId)).toBe(true);
    expect(await allowed(fixture.otherMember, fixture.restrictedSpaceId)).toBe(
      false,
    );
  });

  it("also applies automatic narrowing when reopening a closed floor as teams", async () => {
    await database.db
      .update(spaces)
      .set({ access: "everyone" })
      .where(eq(spaces.id, fixture.publicSpaceId));
    expect(await actions().setFloorAccess(floorInput("closed"))).toMatchObject({
      ok: true,
    });
    const result = await actions().setFloorAccess({
      ...floorInput(),
      teamIds: [fixture.otherTeamId],
    });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("Expected floor access change.");
    expect(result.data.changedSpaces).toHaveLength(2);
    expect(
      await getSpaceForAccess(fixture.publicSpaceId, database.db),
    ).toMatchObject({ access: null });
    expect(
      await getSpaceForAccess(fixture.restrictedSpaceId, database.db),
    ).toMatchObject({ access: "closed", allowedTeamIds: [] });
  });

  it("reconciles space grants with deduplication and clears them when inheriting the floor", async () => {
    expect(
      await actions().setSpaceAccess({
        ...spaceInput(),
        teamIds: [
          fixture.teamId,
          fixture.otherTeamId,
          fixture.otherTeamId.toUpperCase(),
        ],
      }),
    ).toEqual({ ok: true, data: { spaceId: fixture.publicSpaceId } });
    const initial = await grants("space", fixture.publicSpaceId);
    expect(initial).toHaveLength(2);
    expect(await actions().setSpaceAccess(spaceInput())).toMatchObject({
      ok: true,
    });
    expect(await grants("space", fixture.publicSpaceId)).toEqual(
      initial.filter(({ teamId }) => teamId === fixture.teamId),
    );
    expect(await actions().setSpaceAccess(spaceInput(null))).toMatchObject({
      ok: true,
    });
    expect(await grants("space", fixture.publicSpaceId)).toEqual([]);
    expect(
      await getSpaceForAccess(fixture.publicSpaceId, database.db),
    ).toMatchObject({ access: null });
  });

  it("preserves existing reservations and prevents the removed team from making new reservations", async () => {
    const reservation = await insertFixtureBooking(database, fixture, {
      userId: fixture.otherMember.userId,
      teamId: fixture.otherTeamId,
    });
    expect(await actions().setFloorAccess(floorInput())).toMatchObject({
      ok: true,
    });
    expect(
      await database.db
        .select()
        .from(bookings)
        .where(eq(bookings.id, reservation.id)),
    ).toEqual([reservation]);
    const booking = createBookingActions({
      database: database.db,
      getSession: async () => fixture.otherMember,
      now: () => bookingNow,
      logError: vi.fn(),
    });
    expect(
      await booking.createBooking(
        bookingInput(fixture, {
          teamId: fixture.otherTeamId,
          start: bookingInstant("13:00"),
          end: bookingInstant("14:00"),
        }),
      ),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
  });

  it.each(["setFloorAccess", "setSpaceAccess"] as const)(
    "rejects nonexistent teams in %s without changes",
    async (method) => {
      const original = await spaceSettings();
      expect(
        await actions()[method]({
          ...(method === "setFloorAccess" ? floorInput() : spaceInput()),
          teamIds: [fixture.teamId, "00000000-0000-4000-8000-000000000099"],
        }),
      ).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
        fieldErrors: { teamIds: expect.any(Array) },
      });
      expect(await spaceSettings()).toEqual(original);
      expect(await grants("floor", fixture.floorId)).toEqual([]);
    },
  );

  it.each(["setFloorAccess", "setSpaceAccess"] as const)(
    "rejects empty teams, extraneous grants and unknown input keys in %s",
    async (method) => {
      const input = method === "setFloorAccess" ? floorInput() : spaceInput();
      for (const extra of [
        { teamIds: [] },
        { access: "everyone", teamIds: [fixture.teamId] },
        { access: "closed", teamIds: [fixture.teamId] },
        { branchId: fixture.branchId },
        { userId: fixture.operator.userId },
      ])
        expect(await actions()[method]({ ...input, ...extra })).toMatchObject({
          ok: false,
          code: "INVALID_INPUT",
        });
    },
  );

  it("limits floor teams after deduplication", async () => {
    const teamIds = Array.from(
      { length: 21 },
      (_, index) =>
        `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    );
    expect(
      await actions().setFloorAccess({ ...floorInput(), teamIds }),
    ).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { teamIds: expect.any(Array) },
    });
    expect(
      await actions().setFloorAccess({
        ...floorInput(),
        teamIds: Array<string>(21).fill(fixture.teamId),
      }),
    ).toMatchObject({ ok: true });
  });

  it("rejects everyone and teams outside the parent floor while allowing a subset", async () => {
    expect(await actions().setFloorAccess(floorInput())).toMatchObject({
      ok: true,
    });
    expect(
      await actions().setSpaceAccess(spaceInput("everyone")),
    ).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { access: expect.any(Array) },
    });
    expect(
      await actions().setSpaceAccess({
        ...spaceInput(),
        teamIds: [fixture.teamId, fixture.otherTeamId],
      }),
    ).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { teamIds: expect.any(Array) },
    });
    expect(await actions().setSpaceAccess(spaceInput())).toMatchObject({
      ok: true,
    });
    expect(await actions().setSpaceAccess(spaceInput("closed"))).toMatchObject({
      ok: true,
    });
    expect(await actions().setSpaceAccess(spaceInput(null))).toMatchObject({
      ok: true,
    });
  });

  it.each(["person", "otherOperator", "unauthenticated", "disabled"] as const)(
    "protects both access actions from %s",
    async (kind) => {
      if (kind === "disabled")
        await database.db.insert(roleSettings).values({
          branchId: fixture.branchId,
          role: "operator",
          permissions: defaultPermissions.operator.filter(
            (permission) => permission !== "plan.edit",
          ),
        });
      const current = actions(
        kind === "unauthenticated"
          ? null
          : kind === "disabled"
            ? fixture.operator
            : fixture[kind],
      );
      const expected = {
        ok: false,
        code:
          kind === "unauthenticated"
            ? "UNAUTHENTICATED"
            : kind === "disabled"
              ? "FORBIDDEN"
              : "NOT_FOUND",
      };
      expect(await current.setFloorAccess(floorInput())).toEqual(expected);
      expect(await current.setSpaceAccess(spaceInput())).toEqual(expected);
    },
  );

  it("does not treat a user plan.edit override as branch staff membership", async () => {
    await database.db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "user",
      permissions: ["plan.edit"],
    });
    expect(await actions(fixture.person).setFloorAccess(floorInput())).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(await actions(fixture.person).setSpaceAccess(spaceInput())).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });

  it.each(["deskId", "archivedSpaceId"] as const)(
    "hides %s from individual space access writes",
    async (key) => {
      expect(
        await actions().setSpaceAccess({
          ...spaceInput(),
          spaceId: fixture[key],
        }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
    },
  );

  it("looks up the actual target branch and hides missing targets", async () => {
    for (const floorId of [
      fixture.otherFloorId,
      "00000000-0000-4000-8000-000000000099",
    ])
      expect(
        await actions().setFloorAccess({ ...floorInput(), floorId }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
    for (const spaceId of [
      fixture.otherSpaceId,
      "00000000-0000-4000-8000-000000000099",
    ])
      expect(
        await actions().setSpaceAccess({ ...spaceInput(), spaceId }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
  });

  it("publishes space status only after access and grants have committed", async () => {
    const realtime = createMemoryRealtime();
    const listener = vi.fn();
    realtime.subscribe(`floor:${fixture.floorId}`, listener);
    const publish = vi.fn(async (channel, event) => {
      expect(
        await getSpaceForAccess(fixture.publicSpaceId, database.db),
      ).toMatchObject({
        access: "teams",
        allowedTeamIds: [fixture.teamId],
      });
      await realtime.publish(channel, event);
    }) satisfies NonNullable<AdminDependencies["publisher"]>["publish"];
    expect(
      await actions(fixture.operator, {
        publisher: { publish },
      }).setSpaceAccess(spaceInput()),
    ).toEqual({ ok: true, data: { spaceId: fixture.publicSpaceId } });
    expect(publish).toHaveBeenCalledExactlyOnceWith(
      `floor:${fixture.floorId}`,
      {
        type: "space.status_changed",
        spaceId: fixture.publicSpaceId,
      },
    );
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps the committed result when the space notification fails and logs no underlying details", async () => {
    const logError = vi.fn();
    const publish = vi
      .fn()
      .mockRejectedValue(new Error("private provider token"));
    expect(
      await actions(fixture.operator, {
        logError,
        publisher: { publish },
      }).setSpaceAccess(spaceInput()),
    ).toEqual({ ok: true, data: { spaceId: fixture.publicSpaceId } });
    expect(
      await getSpaceForAccess(fixture.publicSpaceId, database.db),
    ).toMatchObject({ access: "teams", allowedTeamIds: [fixture.teamId] });
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      "Space update notification failed.",
    );
  });

  it("rolls back the whole floor and all prior space adjustments if an adjustment fails", async () => {
    await database.db
      .update(spaces)
      .set({ access: "everyone" })
      .where(eq(spaces.id, fixture.publicSpaceId));
    const originalFloor = await getFloorWithAccess(
      fixture.floorId,
      database.db,
    );
    const originalSpaces = await spaceSettings();
    const actual = adminDal.setSpaceAccessRecord;
    const update = vi
      .spyOn(adminDal, "setSpaceAccessRecord")
      .mockImplementation(async (...args) => {
        await actual(...args);
        throw new Error("private SQL failure");
      });
    const publish = vi.fn();
    expect(
      await actions(fixture.operator, {
        publisher: { publish },
      }).setFloorAccess({ ...floorInput(), teamIds: [fixture.otherTeamId] }),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(update).toHaveBeenCalledTimes(1);
    expect(await getFloorWithAccess(fixture.floorId, database.db)).toEqual(
      originalFloor,
    );
    expect(await spaceSettings()).toEqual(originalSpaces);
    expect(publish).not.toHaveBeenCalled();
  });

  it("rolls back a space access update when reconciling its grants fails", async () => {
    const original = await getSpaceForAccess(
      fixture.publicSpaceId,
      database.db,
    );
    const actual = adminDal.replaceAccessGrants;
    vi.spyOn(adminDal, "replaceAccessGrants").mockImplementation(
      async (...args) => {
        await actual(...args);
        throw new Error("private SQL failure");
      },
    );
    const publish = vi.fn();
    expect(
      await actions(fixture.operator, {
        publisher: { publish },
      }).setSpaceAccess(spaceInput()),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(await getSpaceForAccess(fixture.publicSpaceId, database.db)).toEqual(
      original,
    );
    expect(publish).not.toHaveBeenCalled();
  });

  it.each(["setFloorAccess", "setSpaceAccess"] as const)(
    "acquires the required parent-first row locks before changing access in %s",
    async (method) => {
      const statements: string[] = [];
      const logged = drizzle({
        client: database.client,
        schema,
        logger: {
          logQuery(query) {
            statements.push(query);
          },
        },
      });
      const current = actions(fixture.operator, { database: logged });
      expect(
        await current[method](
          method === "setFloorAccess"
            ? { ...floorInput(), teamIds: [fixture.otherTeamId] }
            : spaceInput(),
        ),
      ).toMatchObject({ ok: true });
      const floorLock = statements.findIndex((query) =>
        new RegExp(
          `from "floors".*for ${method === "setFloorAccess" ? "update" : "share"}`,
          "u",
        ).test(query),
      );
      const spaceLock = statements.findIndex((query) =>
        /from "spaces".*for update/u.test(query),
      );
      const firstWrite = statements.findIndex((query) =>
        /^(?:update|insert into|delete from) /u.test(query),
      );
      expect(floorLock).toBeGreaterThanOrEqual(0);
      expect(firstWrite).toBeGreaterThan(floorLock);
      if (method === "setSpaceAccess") {
        expect(spaceLock).toBeGreaterThan(floorLock);
        expect(firstWrite).toBeGreaterThan(spaceLock);
      } else {
        const spaceWrite = statements.findIndex((query) =>
          query.startsWith('update "spaces"'),
        );
        expect(spaceWrite).toBeGreaterThan(floorLock);
      }
      // PGlite에서는 다중 연결의 실제 교착을 검증하지 않고 SQL 잠금 순서만 확인한다.
      expect(statements.some((query) => /\bnow\s*\(/iu.test(query))).toBe(
        false,
      );
    },
  );
});
