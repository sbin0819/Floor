import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { TokenParams, TokenRequest } from "ably";
import { createRealtimeToken } from "@/features/chat/realtime-token";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import { createTeamSpace } from "@/lib/dal/chat-write";
import { readRealtimeFloorAccess } from "@/lib/dal/realtime-floors";
import {
  accessGrants,
  branches,
  chatRooms,
  floors,
  roleSettings,
  teamMembers,
  teams,
} from "@/lib/db/schema";
import { can } from "@/lib/permissions/can";
import { canAccessFloor } from "@/lib/permissions/can-access";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import {
  bookingNow,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("floor realtime capabilities", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  let meter: ReturnType<typeof createQueryMeter>;
  const issue = vi.fn(async (params: TokenParams): Promise<TokenRequest> => ({
    clientId: params.clientId,
    ttl: params.ttl,
    capability: JSON.stringify(params.capability),
    keyName: "fake",
    mac: "fake",
    nonce: "fake",
    timestamp: bookingNow.getTime(),
  }));
  beforeAll(async () => {
    database = await createTestDatabase();
    meter = createQueryMeter(database.client);
  });
  beforeEach(async () => {
    actors = await seedBookingActors(database);
    issue.mockClear();
  });
  afterAll(async () => {
    meter.restore();
    await database.client.close();
  });
  const token = (actor: Session = actors.person) =>
    createRealtimeToken({
      database: database.db,
      requireSession: async () => actor,
      getKey: () => "fake-only",
      createTokenRequest: issue,
      limiter: createMemoryRateLimiter(),
    });
  async function capability(actor = actors.person, rooms: string[] = []) {
    const result = await token(actor)({ rooms });
    return JSON.parse(result.capability) as Record<string, string[]>;
  }
  const floorIds = (value: Record<string, string[]>) =>
    Object.keys(value)
      .filter((key) => key.startsWith("floor:"))
      .map((key) => key.slice(6));

  it("grants public and team floors only after both standard permission checks", async () => {
    expect(floorIds(await capability())).toEqual([
      actors.floorId,
      actors.otherFloorId,
    ]);
    expect(floorIds(await capability(actors.member))).toEqual([
      actors.floorId,
      actors.restrictedFloorId,
      actors.otherFloorId,
    ]);
    expect(floorIds(await capability(actors.otherMember))).toEqual([
      actors.floorId,
      actors.otherFloorId,
    ]);
    for (const actor of [actors.person, actors.member, actors.operator]) {
      const { context, floors: rows } = await readRealtimeFloorAccess(
        actor.userId,
        database.db,
      );
      expect(floorIds(await capability(actor))).toEqual(
        rows
          .filter(
            (floor) =>
              can(context, "floor.view", { branchId: floor.branchId }) &&
              canAccessFloor(context, floor),
          )
          .map((floor) => floor.id),
      );
    }
  });
  it("uses operator override only for that branch's closed/team scope", async () => {
    await database.db
      .update(floors)
      .set({ access: "closed" })
      .where(eq(floors.id, actors.floorId));
    expect(floorIds(await capability(actors.operator))).toEqual([
      actors.floorId,
      actors.restrictedFloorId,
      actors.otherFloorId,
    ]);
    expect(floorIds(await capability(actors.otherOperator))).toEqual([
      actors.otherFloorId,
    ]);
    expect(floorIds(await capability(actors.member))).toEqual([
      actors.restrictedFloorId,
      actors.otherFloorId,
    ]);
  });
  it("preserves absent settings vs explicit empty settings, including operator floor.view", async () => {
    await database.db
      .insert(roleSettings)
      .values({ branchId: actors.branchId, role: "user", permissions: [] });
    for (const actor of [actors.person, actors.member, actors.operator])
      expect(floorIds(await capability(actor))).toEqual([actors.otherFloorId]);
    await database.db.insert(roleSettings).values({
      branchId: actors.branchId,
      role: "operator",
      permissions: ["floor.view", "invalid-permission"],
    });
    await database.db
      .update(floors)
      .set({ access: "closed" })
      .where(eq(floors.id, actors.floorId));
    expect(floorIds(await capability(actors.operator))).toEqual([
      actors.floorId,
      actors.restrictedFloorId,
      actors.otherFloorId,
    ]);
    const { context } = await readRealtimeFloorAccess(
      actors.operator.userId,
      database.db,
    );
    expect(context.roleSettings[actors.branchId]).toEqual({
      user: [],
      operator: ["floor.view"],
    });
    expect(floorIds(await capability(actors.person))).toEqual([
      actors.otherFloorId,
    ]);
  });
  it("does not promote a team-scoped grant into a branch-wide role permission", async () => {
    await database.db.insert(roleSettings).values([
      { branchId: actors.branchId, role: "user", permissions: [] },
      {
        branchId: actors.branchId,
        role: "team_member",
        permissions: ["floor.view"],
      },
      {
        branchId: actors.branchId,
        role: "team_admin",
        permissions: ["floor.view"],
      },
    ]);
    expect(floorIds(await capability(actors.admin))).toEqual([
      actors.otherFloorId,
    ]);
  });
  it("rechecks revoked membership and deleted teams without cached authorization", async () => {
    const read = token(actors.member);
    expect(
      floorIds(JSON.parse((await read({ rooms: [] })).capability)),
    ).toContain(actors.restrictedFloorId);
    await database.db
      .update(teams)
      .set({ deletedAt: bookingNow, deletedBy: actors.admin.userId })
      .where(eq(teams.id, actors.teamId));
    expect(
      floorIds(JSON.parse((await read({ rooms: [] })).capability)),
    ).not.toContain(actors.restrictedFloorId);
    await database.db
      .update(teams)
      .set({ deletedAt: null, deletedBy: null })
      .where(eq(teams.id, actors.teamId));
    await database.db
      .delete(teamMembers)
      .where(eq(teamMembers.userId, actors.member.userId));
    expect(
      floorIds(JSON.parse((await read({ rooms: [] })).capability)),
    ).not.toContain(actors.restrictedFloorId);
  });
  it("does not treat space grants or grants from another floor as floor membership", async () => {
    await database.db.insert(accessGrants).values({
      targetType: "space",
      targetId: actors.restrictedFloorId,
      teamId: actors.otherTeamId,
    });
    expect(floorIds(await capability(actors.otherMember))).not.toContain(
      actors.restrictedFloorId,
    );
  });
  it("filters before the 200 cap and orders by branch then floor order/level/id", async () => {
    await database.db.update(floors).set({ access: "closed" });
    const branchIds = [crypto.randomUUID(), crypto.randomUUID()];
    await database.db.insert(branches).values([
      { id: branchIds[0], name: "A 제한" },
      { id: branchIds[1], name: "B 공개" },
    ]);
    const expected = Array.from({ length: 201 }, (_, index) => ({
      id: crypto.randomUUID(),
      branchId: branchIds[1]!,
      name: `공개 ${index}`,
      level: index + 1,
      sortOrder: index % 3,
    }));
    await database.db.insert(floors).values([
      ...Array.from({ length: 205 }, (_, index) => ({
        branchId: branchIds[0]!,
        name: `제한 ${index}`,
        level: index + 1,
        access: "closed" as const,
      })),
      ...expected,
    ]);
    expected.sort(
      (a, b) =>
        a.sortOrder - b.sortOrder ||
        a.level - b.level ||
        a.id.localeCompare(b.id),
    );
    meter.start();
    const actual = await capability();
    expect(meter.stop()).toEqual({ stages: 1, statements: 2, perStage: [2] });
    expect(floorIds(actual)).toEqual(
      expected.slice(0, 200).map((floor) => floor.id),
    );
    expect(actual).not.toHaveProperty(`floor:${expected[200]!.id}`);
    expect(
      Object.entries(actual)
        .filter(([key]) => key.startsWith("floor:"))
        .every(
          ([, operations]) => JSON.stringify(operations) === '["subscribe"]',
        ),
    ).toBe(true);
  });
  it("keeps the full token at one stage and five statements with three rooms and many floors", async () => {
    const space = await createTeamSpace(actors.teamId, database.db);
    if (!space.roomId) throw new Error("Expected a team room");
    const rooms = await database.db
      .insert(chatRooms)
      .values([
        { kind: "text", spaceId: space.spaceId, name: "두 번째" },
        { kind: "text", spaceId: space.spaceId, name: "세 번째" },
      ])
      .returning({ id: chatRooms.id });
    const ids = [space.roomId, ...rooms.map((room) => room.id)];
    for (const count of [0, 1, 3]) {
      meter.start();
      await capability(actors.member, ids.slice(0, count));
      expect(meter.stop()).toEqual({
        stages: 1,
        statements: count + 2,
        perStage: [count + 2],
      });
    }
    await database.db.insert(floors).values(
      Array.from({ length: 220 }, (_, i) => ({
        branchId: actors.branchId,
        level: i + 20,
        name: `추가${i}`,
      })),
    );
    meter.start();
    await capability(actors.member, ids);
    expect(meter.stop().perStage).toEqual([5]);
    meter.start();
    await capability(actors.member, [space.roomId, space.roomId]);
    expect(meter.stop().perStage).toEqual([3]);
  });
  it("never grants publish, wildcard, floor presence or person/space metadata", async () => {
    const value = await token(actors.member)({ rooms: [] });
    expect(value.clientId).toBe(actors.member.userId);
    expect(value.ttl).toBe(600_000);
    expect(value.capability).not.toMatch(
      /publish|\*|회의실|강남|서초|김하은|@/,
    );
    for (const [channel, operations] of Object.entries(
      JSON.parse(value.capability),
    ))
      if (channel.startsWith("floor:"))
        expect(operations).toEqual(["subscribe"]);
  });
  it("rejects client-chosen floors and checks the session before SQL or JSON", async () => {
    meter.start();
    await expect(
      token()({ rooms: [], floors: [actors.floorId] }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(meter.stop().statements).toBe(0);
    const body = vi.fn();
    meter.start();
    await expect(
      createRealtimeToken({
        database: database.db,
        requireSession: async () => {
          throw new ActionError("UNAUTHENTICATED");
        },
        getKey: () => "fake",
      })(body),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(meter.stop().statements).toBe(0);
    expect(body).not.toHaveBeenCalled();
  });
  it("returns no floor access for a missing account and does not select credential columns", async () => {
    meter.start();
    const result = await readRealtimeFloorAccess(
      crypto.randomUUID(),
      database.db,
    );
    expect(meter.stop().perStage).toEqual([1]);
    expect(result.floors).toEqual([]);
    expect(result.context).toMatchObject({
      teams: [],
      staffBranchIds: [],
      roleSettings: {},
    });
    const queries = vi.spyOn(database.client, "query");
    await readRealtimeFloorAccess(actors.member.userId, database.db);
    expect(queries.mock.calls.map(([query]) => query).join("\n")).not.toMatch(
      /\b(?:email|password|session|document|photo|image)\b/i,
    );
    queries.mockRestore();
    await database.db.execute(sql`select 1`);
  });
});
