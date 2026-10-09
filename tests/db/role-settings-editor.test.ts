import { and, eq, sql } from "drizzle-orm";
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
import { createRoleSettingsActions } from "@/features/admin/role-settings-action-factory";
import { createRoleSettingsQueries } from "@/features/admin/role-settings-query-factory";
import type { RoleSettingInput } from "@/features/admin/role-settings-types";
import { createBookingActions } from "@/features/bookings/create-booking-factory";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import * as settingsDal from "@/lib/dal/role-settings-editor";
import * as dbSchema from "@/lib/db/schema";
import {
  bookings,
  branches,
  branchStaff,
  roleSettings,
  users,
} from "@/lib/db/schema";
import { can } from "@/lib/permissions/can";
import { loadPermissionContext } from "@/lib/permissions/context";
import { defaultLimits, defaultPermissions } from "@/lib/permissions/defaults";
import { permissionKeys, roles, type Role } from "@/lib/permissions/keys";
import {
  bookingInput,
  bookingInstant,
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("role settings editor database contracts", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  let meter: ReturnType<typeof createQueryMeter>;
  const statements: string[] = [];
  const logError = vi.fn();
  const publish = vi.fn(async () => {});
  const publishMany = vi.fn(async () => {});
  const next = new Date(bookingNow.getTime() + 1);

  beforeAll(async () => {
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema: dbSchema,
      logger: { logQuery: (query) => statements.push(query) },
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
    statements.length = 0;
  });

  function actions(
    session: Session | null = fixture.operator,
    now = bookingNow,
  ) {
    return createRoleSettingsActions({
      database: database.db,
      getSession: async () => session,
      now: () => now,
      logError,
    });
  }
  function read(branchId = fixture.branchId, session = fixture.operator) {
    return createRoleSettingsQueries({
      database: database.db,
      requireSession: async () => session,
    }).getRoleSettingsEditor(branchId);
  }
  function setting(role: Role = "user"): RoleSettingInput {
    return { role, permissions: [...defaultPermissions[role]], limits: {} };
  }
  function input(
    changes: RoleSettingInput[] = [setting()],
    expected: string | null = null,
  ) {
    return {
      branchId: fixture.branchId,
      roles: changes,
      expectedUpdatedAt: expected,
    };
  }
  async function rows() {
    return database.db
      .select()
      .from(roleSettings)
      .orderBy(roleSettings.branchId, roleSettings.role);
  }
  function book(session = fixture.person) {
    return createBookingActions({
      database: database.db,
      getSession: async () => session,
      now: () => bookingNow,
      publisher: { publish },
      chatPublisher: { publish, publishMany },
      livekit: null,
      logError,
    }).createBooking({
      ...bookingInput(fixture),
      start: bookingInstant("13:00"),
      end: bookingInstant("14:30"),
    });
  }

  it("returns only the editor projection and four unstored defaults in [3, 1]", async () => {
    meter.start();
    const result = await read();
    expect(meter.stop().perStage).toEqual([3, 1]);
    expect(result).toEqual({
      branch: { id: fixture.branchId, name: "강남점", timezone: "Asia/Seoul" },
      roles: Object.fromEntries(
        roles.map((role) => [
          role,
          {
            permissions: [...defaultPermissions[role]],
            limits: { ...defaultLimits[role] },
            stored: false,
          },
        ]),
      ),
      updatedAt: null,
      updatedByName: null,
      context: { branchId: fixture.branchId, isOperator: true },
    });
    expect(JSON.stringify(result)).not.toContain(fixture.operator.email);
    expect(JSON.stringify(result)).not.toContain(fixture.operator.userId);
  });

  it("keeps the query budget fixed with every role and many unrelated branch rows", async () => {
    await actions().updateRoleSettings(input(roles.map(setting)));
    const branchIds = Array.from({ length: 30 }, () => crypto.randomUUID());
    await database.db.insert(branches).values(
      branchIds.map((id, index) => ({
        id,
        name: `가상 ${index}`,
        address: "가상 주소",
      })),
    );
    await database.db.insert(roleSettings).values(
      branchIds.flatMap((branchId) =>
        roles.map((role) => ({
          branchId,
          role,
          permissions: ["roles.manage"],
          updatedBy: fixture.otherOperator.userId,
        })),
      ),
    );
    meter.start();
    const result = await read();
    expect(meter.stop().perStage).toEqual([3, 1]);
    expect(Object.values(result.roles).every((role) => role.stored)).toBe(true);
    expect(result.updatedByName).toBe(fixture.operator.name);
    expect(JSON.stringify(result)).not.toContain(fixture.otherOperator.name);
  });

  it("preserves raw known permissions and partial limits instead of pretending stored rows are defaults", async () => {
    await database.db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "user",
      permissions: ["stats.view", "unknown.private.permission"],
      limits: { maxMinutesPerBooking: null },
      updatedAt: bookingNow,
    });
    const result = await read();
    expect(result.roles.user).toEqual({
      permissions: ["stats.view"],
      limits: { maxMinutesPerBooking: null },
      stored: true,
    });
    expect(result.roles.operator.stored).toBe(false);
    expect(result.updatedAt).toBe(bookingNow.toISOString());
    expect(result.updatedByName).toBeNull();
  });

  it("selects the latest row's current updater name and truncates microseconds consistently", async () => {
    await database.db.insert(roleSettings).values([
      {
        branchId: fixture.branchId,
        role: "user",
        permissions: [],
        updatedAt: bookingNow,
        updatedBy: fixture.operator.userId,
      },
      {
        branchId: fixture.branchId,
        role: "team_member",
        permissions: [],
        updatedAt: bookingNow,
        updatedBy: fixture.stranger.userId,
      },
    ]);
    await database.db.execute(
      sql`update role_settings set updated_at = '2026-10-07T03:10:00.123456Z'::timestamptz where branch_id = ${fixture.branchId} and role = 'user'`,
    );
    await database.db.execute(
      sql`update role_settings set updated_at = '2026-10-07T03:10:00.123999Z'::timestamptz where branch_id = ${fixture.branchId} and role = 'team_member'`,
    );
    await database.db
      .update(users)
      .set({ name: "바뀐 표시 이름" })
      .where(eq(users.id, fixture.stranger.userId));
    const result = await read();
    expect(result.updatedAt).toBe("2026-10-07T03:10:00.123Z");
    expect(result.updatedByName).toBe("바뀐 표시 이름");
    expect(
      await actions(
        fixture.operator,
        new Date("2026-10-07T03:10:00.124Z"),
      ).updateRoleSettings(input([setting()], result.updatedAt)),
    ).toEqual({
      ok: true,
      data: { updatedAt: "2026-10-07T03:10:00.124Z" },
    });
  });

  it("checks the query session before invalid IDs without querying", async () => {
    const requireSession = vi.fn(async () => {
      throw new ActionError("UNAUTHENTICATED");
    });
    meter.start();
    await expect(
      createRoleSettingsQueries({
        database: database.db,
        requireSession,
      }).getRoleSettingsEditor("invalid"),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(meter.stop().perStage).toEqual([]);
    expect(requireSession).toHaveBeenCalledTimes(1);
    await expect(read("invalid")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it.each(["person", "admin", "otherOperator"] as const)(
    "conceals this branch's editor and writes from %s",
    async (actor) => {
      await expect(
        read(fixture.branchId, fixture[actor]),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(await actions(fixture[actor]).updateRoleSettings(input())).toEqual(
        { ok: false, code: "NOT_FOUND" },
      );
      expect(
        await actions(fixture[actor]).resetRoleSettings({
          branchId: fixture.branchId,
          expectedUpdatedAt: null,
        }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(await rows()).toEqual([]);
    },
  );

  it("conceals missing and other branches from an operator and normalizes an owned uppercase ID", async () => {
    for (const branchId of [fixture.otherBranchId, crypto.randomUUID()]) {
      await expect(read(branchId)).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(
        await actions().updateRoleSettings({ ...input(), branchId }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
    }
    expect((await read(fixture.branchId.toUpperCase())).branch.id).toBe(
      fixture.branchId,
    );
    expect(
      await actions().updateRoleSettings({
        ...input(),
        branchId: fixture.branchId.toUpperCase(),
      }),
    ).toEqual({ ok: true, data: { updatedAt: bookingNow.toISOString() } });
  });

  it("checks the action session before schema validation or SQL for both entry points", async () => {
    meter.start();
    expect(await actions(null).updateRoleSettings(null)).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(await actions(null).resetRoleSettings(null)).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(meter.stop().perStage).toEqual([]);
  });

  it.each([
    { label: "empty roles", patch: { roles: [] } },
    {
      label: "duplicate roles",
      patch: {
        roles: [
          { role: "user", permissions: [], limits: {} },
          { role: "user", permissions: [], limits: {} },
        ],
      },
    },
    {
      label: "unknown role",
      patch: { roles: [{ role: "owner", permissions: [], limits: {} }] },
    },
    {
      label: "unknown permission",
      patch: {
        roles: [{ role: "user", permissions: ["root.admin"], limits: {} }],
      },
    },
    { label: "extra root field", patch: { userId: "spoofed" } },
    { label: "invalid version", patch: { expectedUpdatedAt: "yesterday" } },
    {
      label: "minute below minimum",
      patch: {
        roles: [
          {
            role: "user",
            permissions: [],
            limits: { maxMinutesPerBooking: 0 },
          },
        ],
      },
    },
    {
      label: "non-multiple minutes",
      patch: {
        roles: [
          { role: "user", permissions: [], limits: { maxMinutesPerDay: 45 } },
        ],
      },
    },
    {
      label: "minutes above maximum",
      patch: {
        roles: [
          {
            role: "user",
            permissions: [],
            limits: { maxMinutesPerBooking: 1470 },
          },
        ],
      },
    },
    {
      label: "fractional days",
      patch: {
        roles: [
          { role: "user", permissions: [], limits: { maxDaysAhead: 1.5 } },
        ],
      },
    },
    {
      label: "zero days",
      patch: {
        roles: [{ role: "user", permissions: [], limits: { maxDaysAhead: 0 } }],
      },
    },
    {
      label: "days above maximum",
      patch: {
        roles: [
          { role: "user", permissions: [], limits: { maxDaysAhead: 91 } },
        ],
      },
    },
    {
      label: "extra limit",
      patch: {
        roles: [{ role: "user", permissions: [], limits: { secret: 30 } }],
      },
    },
    {
      label: "team admin limit",
      patch: {
        roles: [
          {
            role: "team_admin",
            permissions: [],
            limits: { maxDaysAhead: null },
          },
        ],
      },
    },
  ])("rejects $label before authorization SQL", async ({ patch }) => {
    meter.start();
    expect(
      await actions().updateRoleSettings({ ...input(), ...patch }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(meter.stop().perStage).toEqual([]);
    expect(await rows()).toEqual([]);
  });

  it("normalizes all fixed permission cells while preserving editable permissions and partial/null limits", async () => {
    const result = await actions().updateRoleSettings(
      input([
        {
          role: "user",
          permissions: [...permissionKeys, "floor.view"],
          limits: {
            maxMinutesPerBooking: 30,
            maxMinutesPerDay: 1440,
            maxDaysAhead: 90,
          },
        },
        {
          role: "team_member",
          permissions: [],
          limits: { maxMinutesPerDay: null },
        },
        {
          role: "team_admin",
          permissions: ["roles.manage", "chat.team", "booking.own"],
          limits: {},
        },
        {
          role: "operator",
          permissions: [
            "floor.view",
            "chat.team",
            "chat.team.moderate",
            "team.manage_members",
          ],
          limits: {
            maxMinutesPerBooking: null,
            maxMinutesPerDay: 30,
            maxDaysAhead: 1,
          },
        },
      ]),
    );
    expect(result).toEqual({
      ok: true,
      data: { updatedAt: bookingNow.toISOString() },
    });
    const stored = await rows();
    expect(
      stored.map(({ role, permissions, limits }) => ({
        role,
        permissions,
        limits,
      })),
    ).toEqual([
      {
        role: "user",
        permissions: [
          "floor.view",
          "booking.own",
          "chat.lounge",
          "booking.team",
          "booking.manage_team",
        ],
        limits: {
          maxMinutesPerBooking: 30,
          maxMinutesPerDay: 1440,
          maxDaysAhead: 90,
        },
      },
      {
        role: "team_member",
        permissions: ["chat.team"],
        limits: { maxMinutesPerDay: null },
      },
      {
        role: "team_admin",
        permissions: [
          "booking.own",
          "chat.team.moderate",
          "team.manage_members",
        ],
        limits: {},
      },
      {
        role: "operator",
        permissions: ["floor.view", "roles.manage"],
        limits: {
          maxMinutesPerBooking: null,
          maxMinutesPerDay: 30,
          maxDaysAhead: 1,
        },
      },
    ]);
    expect(
      stored.every(
        (row) =>
          row.updatedAt.toISOString() === bookingNow.toISOString() &&
          row.updatedBy === fixture.operator.userId,
      ),
    ).toBe(true);
    expect((await read()).updatedByName).toBe(fixture.operator.name);
  });

  it("upserts only changed roles, preserves untouched branch rows, and retains can()'s permission union", async () => {
    await database.db.insert(roleSettings).values([
      {
        branchId: fixture.branchId,
        role: "user",
        permissions: ["floor.view"],
        limits: {},
        updatedAt: bookingNow,
        updatedBy: fixture.operator.userId,
      },
      {
        branchId: fixture.otherBranchId,
        role: "user",
        permissions: [],
        limits: {},
        updatedAt: bookingNow,
      },
    ]);
    const before = await rows();
    expect(
      await actions(fixture.operator, next).updateRoleSettings(
        input(
          [{ ...setting("operator"), permissions: ["booking.own"] }],
          bookingNow.toISOString(),
        ),
      ),
    ).toEqual({ ok: true, data: { updatedAt: next.toISOString() } });
    const after = await rows();
    for (const row of before) expect(after).toContainEqual(row);
    const context = await loadPermissionContext(
      fixture.operator,
      fixture.branchId,
      database.db,
    );
    expect(can(context, "floor.view", { branchId: fixture.branchId })).toBe(
      true,
    );
    expect(can(context, "booking.own", { branchId: fixture.branchId })).toBe(
      true,
    );
    expect(can(context, "roles.manage", { branchId: fixture.branchId })).toBe(
      true,
    );
    expect(can(context, "space.manage", { branchId: fixture.branchId })).toBe(
      false,
    );
  });

  it("allows recovery even when a legacy operator row stored no permissions", async () => {
    await database.db.insert(roleSettings).values({
      branchId: fixture.branchId,
      role: "operator",
      permissions: [],
      updatedAt: bookingNow,
    });
    expect((await read()).roles.operator.permissions).toEqual([]);
    expect(
      await actions(fixture.operator, next).updateRoleSettings(
        input([setting("operator")], bookingNow.toISOString()),
      ),
    ).toEqual({ ok: true, data: { updatedAt: next.toISOString() } });
    expect((await rows())[0]?.permissions).toContain("roles.manage");
  });

  it("rejects the second first-save snapshot and disjoint-role stale snapshots without changing data", async () => {
    expect(await actions().updateRoleSettings(input())).toMatchObject({
      ok: true,
    });
    const first = await rows();
    expect(
      await actions(fixture.operator, next).updateRoleSettings(
        input([setting("team_member")]),
      ),
    ).toEqual({ ok: false, code: "STALE" });
    expect(await rows()).toEqual(first);
    expect(
      await actions(fixture.operator, next).updateRoleSettings(
        input([setting("team_member")], bookingNow.toISOString()),
      ),
    ).toMatchObject({ ok: true });
    const second = await rows();
    expect(
      await actions(
        fixture.operator,
        new Date(next.getTime() + 1),
      ).updateRoleSettings(
        input([setting("operator")], bookingNow.toISOString()),
      ),
    ).toEqual({ ok: false, code: "STALE" });
    expect(await rows()).toEqual(second);
  });

  it.each([0, -1])(
    "rejects a clock %i milliseconds after the current version",
    async (offset) => {
      await actions().updateRoleSettings(input());
      const before = await rows();
      expect(
        await actions(
          fixture.operator,
          new Date(bookingNow.getTime() + offset),
        ).updateRoleSettings(
          input([setting("operator")], bookingNow.toISOString()),
        ),
      ).toEqual({ ok: false, code: "STALE" });
      expect(await rows()).toEqual(before);
    },
  );

  it("compares equivalent ISO offsets and handles absent-row reset without manufacturing a version", async () => {
    expect(
      await actions().resetRoleSettings({
        branchId: fixture.branchId,
        expectedUpdatedAt: bookingNow.toISOString(),
      }),
    ).toEqual({ ok: false, code: "STALE" });
    expect(
      await actions().resetRoleSettings({
        branchId: fixture.branchId,
        expectedUpdatedAt: null,
      }),
    ).toEqual({ ok: true, data: { updatedAt: null } });
    await actions().updateRoleSettings(input());
    expect(
      await actions(fixture.operator, next).updateRoleSettings(
        input([setting("operator")], "2026-10-07T12:10:00+09:00"),
      ),
    ).toEqual({ ok: true, data: { updatedAt: next.toISOString() } });
  });

  it("reset uses the same CAS, removes only this branch's rows, and restores defaults", async () => {
    await actions().updateRoleSettings(input(roles.map(setting)));
    await database.db.insert(roleSettings).values({
      branchId: fixture.otherBranchId,
      role: "user",
      permissions: [],
      updatedAt: bookingNow,
    });
    const before = await rows();
    expect(
      await actions().resetRoleSettings({
        branchId: fixture.branchId,
        expectedUpdatedAt: null,
      }),
    ).toEqual({ ok: false, code: "STALE" });
    expect(await rows()).toEqual(before);
    expect(
      await actions().resetRoleSettings({
        branchId: fixture.branchId,
        expectedUpdatedAt: bookingNow.toISOString(),
      }),
    ).toEqual({ ok: true, data: { updatedAt: null } });
    expect(await rows()).toEqual(
      before.filter((row) => row.branchId === fixture.otherBranchId),
    );
    const editor = await read();
    expect(editor.updatedByName).toBeNull();
    expect(editor.updatedAt).toBeNull();
    expect(editor.roles.user).toEqual({
      permissions: [...defaultPermissions.user],
      limits: { ...defaultLimits.user },
      stored: false,
    });
  });

  it.each(["update", "reset"] as const)(
    "rechecks operator membership after the branch lock for %s",
    async (operation) => {
      await actions().updateRoleSettings(input());
      const before = await rows();
      const original = settingsDal.lockRoleSettingsBranch;
      const lock = vi
        .spyOn(settingsDal, "lockRoleSettingsBranch")
        .mockImplementation(async (branchId, tx) => {
          const result = await original(branchId, tx);
          await tx
            .delete(branchStaff)
            .where(
              and(
                eq(branchStaff.branchId, branchId),
                eq(branchStaff.userId, fixture.operator.userId),
              ),
            );
          return result;
        });
      const result =
        operation === "update"
          ? await actions(fixture.operator, next).updateRoleSettings(
              input([setting("operator")], bookingNow.toISOString()),
            )
          : await actions().resetRoleSettings({
              branchId: fixture.branchId,
              expectedUpdatedAt: bookingNow.toISOString(),
            });
      expect(result).toEqual({ ok: false, code: "NOT_FOUND" });
      expect(lock).toHaveBeenCalledTimes(1);
      expect(await rows()).toEqual(before);
    },
  );

  it.each(["update", "reset"] as const)(
    "locks the branch before version comparison and %s writes",
    async (operation) => {
      await actions().updateRoleSettings(input());
      statements.length = 0;
      const result =
        operation === "update"
          ? await actions(fixture.operator, next).updateRoleSettings(
              input([setting("operator")], bookingNow.toISOString()),
            )
          : await actions().resetRoleSettings({
              branchId: fixture.branchId,
              expectedUpdatedAt: bookingNow.toISOString(),
            });
      expect(result.ok).toBe(true);
      const locks = statements.filter((query) =>
        /\bfor (?:no key update|update|share|key share)\b/i.test(query),
      );
      expect(locks).toHaveLength(1);
      expect(locks[0]).toMatch(/from "branches".*for no key update/i);
      const lockIndex = statements.indexOf(locks[0]!);
      const versionIndex = statements.findIndex((query) =>
        query.includes("date_trunc('milliseconds', max("),
      );
      const writeIndex = statements.findIndex((query) =>
        /^(?:insert into|delete from) "role_settings"/i.test(query),
      );
      expect(lockIndex).toBeLessThan(versionIndex);
      expect(versionIndex).toBeLessThan(writeIndex);
      expect(
        statements
          .slice(lockIndex + 1, versionIndex)
          .some((query) => query.includes('"branch_staff"')),
      ).toBe(true);
    },
  );

  it("rolls back every upsert after a late failure and returns only the public error", async () => {
    const original = settingsDal.writeRoleSettings;
    vi.spyOn(settingsDal, "writeRoleSettings").mockImplementation(
      async (...args) => {
        await original(...args);
        throw new Error("private database failure");
      },
    );
    expect(
      await actions().updateRoleSettings(input(roles.map(setting))),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(await rows()).toEqual([]);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  it("rolls back a reset after deletion fails late", async () => {
    await actions().updateRoleSettings(input(roles.map(setting)));
    const before = await rows();
    const original = settingsDal.removeRoleSettings;
    vi.spyOn(settingsDal, "removeRoleSettings").mockImplementation(
      async (...args) => {
        await original(...args);
        throw new Error("private deletion failure");
      },
    );
    expect(
      await actions().resetRoleSettings({
        branchId: fixture.branchId,
        expectedUpdatedAt: bookingNow.toISOString(),
      }),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(await rows()).toEqual(before);
  });

  it("allows a null updater but does not cascade-delete or silently clear a referenced updater", async () => {
    await database.db
      .insert(roleSettings)
      .values({ branchId: fixture.branchId, role: "user", permissions: [] });
    expect((await rows())[0]?.updatedBy).toBeNull();
    const updater = crypto.randomUUID();
    await database.db.insert(users).values({
      id: updater,
      name: "과거 운영자",
      email: "former@example.test",
    });
    await database.db
      .update(roleSettings)
      .set({ updatedBy: updater })
      .where(eq(roleSettings.branchId, fixture.branchId));
    await expect(
      database.db.delete(users).where(eq(users.id, updater)),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    expect((await rows())[0]?.updatedBy).toBe(updater);
    await expect(
      database.db
        .update(roleSettings)
        .set({ updatedBy: crypto.randomUUID() })
        .where(eq(roleSettings.branchId, fixture.branchId)),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    expect((await rows())[0]?.updatedBy).toBe(updater);
  });

  it("applies booking.own changes on the next request and reset re-enables booking without changing existing reservations", async () => {
    const existing = await insertFixtureBooking(database, fixture, {
      during: bookingRange("15:00", "16:00", "2026-10-08"),
    });
    await actions().updateRoleSettings(
      input([
        {
          role: "user",
          permissions: ["floor.view", "chat.lounge"],
          limits: {},
        },
      ]),
    );
    expect(await book()).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await database.db.select().from(bookings)).toEqual([existing]);
    expect(
      await actions().resetRoleSettings({
        branchId: fixture.branchId,
        expectedUpdatedAt: bookingNow.toISOString(),
      }),
    ).toMatchObject({ ok: true });
    const result = await book();
    expect(result.ok).toBe(true);
    expect(
      await database.db
        .select()
        .from(bookings)
        .where(eq(bookings.id, existing.id)),
    ).toEqual([existing]);
  });

  it("enforces a saved 60 minute limit for a new 90 minute reservation without shortening old bookings", async () => {
    const existing = await insertFixtureBooking(database, fixture, {
      during: bookingRange("15:00", "16:30"),
    });
    expect(
      await actions().updateRoleSettings(
        input([
          {
            ...setting(),
            limits: { maxMinutesPerBooking: 60, maxMinutesPerDay: null },
          },
        ]),
      ),
    ).toMatchObject({ ok: true });
    expect(await book()).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "per_booking",
    });
    expect(await database.db.select().from(bookings)).toEqual([existing]);
  });
});
