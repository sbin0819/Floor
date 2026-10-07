import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import {
  accessGrants,
  bookings,
  branches,
  branchStaff,
  callSessions,
  chatRooms,
  floorPlans,
  floors,
  messages,
  roleSettings,
  spaces,
  teamInvites,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";

const document: FloorPlanDocument = {
  schema: 1,
  unit: "mm",
  bounds: { w: 10000, h: 10000 },
  walls: [],
  openings: [],
  spaces: [],
  seats: [],
  fixtures: [],
};
const during = {
  start: new Date("2026-10-07T10:00:00Z"),
  end: new Date("2026-10-07T11:00:00Z"),
};

describe("database constraints from the real migrations", () => {
  let database: TestDatabase;
  let userId: string;
  let branchId: string;
  let floorId: string;
  let spaceId: string;
  let otherSpaceId: string;
  let teamId: string;
  let roomId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`TRUNCATE TABLE users, branches CASCADE`);
    userId = crypto.randomUUID();
    branchId = crypto.randomUUID();
    floorId = crypto.randomUUID();
    spaceId = crypto.randomUUID();
    otherSpaceId = crypto.randomUUID();
    teamId = crypto.randomUUID();
    roomId = crypto.randomUUID();
    await database.db.insert(users).values({
      id: userId,
      name: "테스트 사용자",
      email: "member@example.test",
    });
    await database.db
      .insert(branches)
      .values({ id: branchId, name: "가상 지점" });
    await database.db
      .insert(floors)
      .values({ id: floorId, branchId, level: 7, name: "7F" });
    await database.db.insert(spaces).values([
      { id: spaceId, floorId, type: "meeting_room", name: "회의실 가" },
      { id: otherSpaceId, floorId, type: "phone_booth", name: "폰부스 가" },
    ]);
    await database.db
      .insert(teams)
      .values({ id: teamId, name: "가상 팀", createdBy: userId });
    await database.db.insert(chatRooms).values({ id: roomId, kind: "inquiry" });
  });

  it("1. rejects overlapping confirmed bookings for one space with SQLSTATE 23P01", async () => {
    await database.db.insert(bookings).values({ spaceId, userId, during });
    await expect(
      database.db.insert(bookings).values({
        spaceId,
        userId,
        during: {
          start: new Date("2026-10-07T10:30:00Z"),
          end: new Date("2026-10-07T11:30:00Z"),
        },
      }),
    ).rejects.toMatchObject({
      cause: { code: "23P01", constraint: "bookings_no_overlap" },
    });
  });

  it("2. allows adjacent [start, end) bookings and returns Date values", async () => {
    await database.db.insert(bookings).values([
      { spaceId, userId, during },
      {
        spaceId,
        userId,
        during: { start: during.end, end: new Date("2026-10-07T12:00:00Z") },
      },
    ]);
    const result = await database.db
      .select()
      .from(bookings)
      .orderBy(bookings.during);
    expect(result).toHaveLength(2);
    expect(result[0]?.during).toEqual(during);
  });

  it("3. permits a confirmed booking overlapping a cancelled booking", async () => {
    await database.db.insert(bookings).values([
      { spaceId, userId, during, status: "cancelled" },
      { spaceId, userId, during },
    ]);
    expect(await database.db.select().from(bookings)).toHaveLength(2);
  });

  it("4. permits simultaneous confirmed bookings in different spaces", async () => {
    await database.db.insert(bookings).values([
      { spaceId, userId, during },
      { spaceId: otherSpaceId, userId, during },
    ]);
    expect(await database.db.select().from(bookings)).toHaveLength(2);
  });

  const invalidRanges = [
    ["empty", "empty"],
    ["unbounded start", '(,"2026-10-07 11:00:00+00")'],
    ["unbounded end", '["2026-10-07 10:00:00+00",)'],
    ["inclusive end", '["2026-10-07 10:00:00+00","2026-10-07 11:00:00+00"]'],
    ["exclusive start", '("2026-10-07 10:00:00+00","2026-10-07 11:00:00+00")'],
  ] as const;

  it.each(invalidRanges)(
    "5. rejects a booking range with %s",
    async (_, value) => {
      await expect(
        database.db.execute(
          sql`INSERT INTO bookings (space_id, user_id, during) VALUES (${spaceId}, ${userId}, ${value}::tstzrange)`,
        ),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "bookings_during_valid" },
      });
    },
  );

  it.each(invalidRanges)(
    "5. rejects a maintenance range with %s",
    async (_, value) => {
      await expect(
        database.db.execute(
          sql`INSERT INTO space_blocks (space_id, created_by, during) VALUES (${spaceId}, ${userId}, ${value}::tstzrange)`,
        ),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "space_blocks_during_valid" },
      });
    },
  );

  it.each(["draft", "published"] as const)(
    "6. permits only one %s plan per floor",
    async (status) => {
      await database.db
        .insert(floorPlans)
        .values({ floorId, version: 1, status, document, createdBy: userId });
      await expect(
        database.db
          .insert(floorPlans)
          .values({ floorId, version: 2, status, document, createdBy: userId }),
      ).rejects.toMatchObject({
        cause: { code: "23505", constraint: `floor_plans_one_${status}` },
      });
    },
  );

  it("6. allows archived plans and prevents duplicate versions", async () => {
    await database.db.insert(floorPlans).values([
      { floorId, version: 1, status: "archived", document, createdBy: userId },
      { floorId, version: 2, status: "archived", document, createdBy: userId },
    ]);
    await expect(
      database.db.insert(floorPlans).values({
        floorId,
        version: 2,
        status: "archived",
        document,
        createdBy: userId,
      }),
    ).rejects.toMatchObject({
      cause: {
        code: "23505",
        constraint: "floor_plans_floor_id_version_unique",
      },
    });
  });

  it("7. rejects duplicate floor levels within a branch", async () => {
    await expect(
      database.db
        .insert(floors)
        .values({ branchId, level: 7, name: "중복 층" }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "floors_branch_id_level_unique" },
    });
  });

  it("8. allows only one active call per room, with completed history retained", async () => {
    await database.db.insert(callSessions).values([
      { roomId, livekitRoom: "past-call", endedAt: new Date() },
      { roomId, livekitRoom: "current-call" },
    ]);
    await expect(
      database.db
        .insert(callSessions)
        .values({ roomId, livekitRoom: "duplicate-call" }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "call_sessions_one_active" },
    });
  });

  it("9. rejects duplicate room message sequence numbers", async () => {
    await database.db
      .insert(messages)
      .values({ roomId, seq: 1, body: "첫 메시지" });
    await expect(
      database.db
        .insert(messages)
        .values({ roomId, seq: 1, body: "중복 메시지" }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "messages_room_id_seq_unique" },
    });
  });

  it("9. rejects duplicate non-null client ids and permits multiple null client ids", async () => {
    await database.db.insert(messages).values([
      { roomId, seq: 1, body: "첫 메시지", clientId: "retry-key" },
      { roomId, seq: 2, body: "둘째 메시지" },
      { roomId, seq: 3, body: "셋째 메시지" },
    ]);
    await expect(
      database.db
        .insert(messages)
        .values({ roomId, seq: 4, body: "재전송", clientId: "retry-key" }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "messages_room_id_client_id_unique" },
    });
  });

  it.each(["booking", "channel", "team"] as const)(
    "10. rejects %s rooms missing their required reference",
    async (kind) => {
      await expect(
        database.db.insert(chatRooms).values({ kind }),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "chat_rooms_kind_ref" },
      });
    },
  );

  it("10. accepts each chat room kind with the appropriate reference", async () => {
    const bookingId = crypto.randomUUID();
    await database.db
      .insert(bookings)
      .values({ id: bookingId, spaceId, userId, during });
    await database.db
      .insert(chatRooms)
      .values([
        { kind: "booking", bookingId },
        { kind: "channel", floorId },
        { kind: "team", teamId, floorId },
        { kind: "inquiry" },
      ]);
    expect(await database.db.select().from(chatRooms)).toHaveLength(5);
  });

  it("enforces both sides of the floor/published-plan circular reference", async () => {
    await expect(
      database.db
        .update(floors)
        .set({ publishedPlanId: crypto.randomUUID() })
        .where(eq(floors.id, floorId)),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(
      database.db.insert(floorPlans).values({
        floorId: crypto.randomUUID(),
        version: 1,
        document,
        createdBy: userId,
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    const planId = crypto.randomUUID();
    await database.db.insert(floorPlans).values({
      id: planId,
      floorId,
      version: 1,
      status: "published",
      document,
      createdBy: userId,
    });
    await database.db
      .update(floors)
      .set({ publishedPlanId: planId })
      .where(eq(floors.id, floorId));
    await expect(
      database.db.delete(floorPlans).where(eq(floorPlans.id, planId)),
    ).rejects.toMatchObject({
      cause: {
        code: "23001",
        constraint: "floors_published_plan_id_floor_plans_id_fk",
      },
    });
  });

  it("enforces composite membership, staff, role-setting and access-grant uniqueness", async () => {
    await database.db.insert(teamMembers).values({ teamId, userId });
    await expect(
      database.db.insert(teamMembers).values({ teamId, userId }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
    await database.db.insert(branchStaff).values({ branchId, userId });
    await expect(
      database.db.insert(branchStaff).values({ branchId, userId }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
    await database.db
      .insert(roleSettings)
      .values({ branchId, role: "user", permissions: [] });
    await expect(
      database.db
        .insert(roleSettings)
        .values({ branchId, role: "user", permissions: [] }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
    const grant = { targetType: "floor" as const, targetId: floorId, teamId };
    await database.db.insert(accessGrants).values(grant);
    await expect(
      database.db.insert(accessGrants).values(grant),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("cascades team membership, invitations and grants and keeps referenced users restricted", async () => {
    await database.db.insert(teamMembers).values({ teamId, userId });
    await database.db
      .insert(teamInvites)
      .values({ teamId, token: "invite-token", createdBy: userId });
    await database.db
      .insert(accessGrants)
      .values({ targetType: "space", targetId: spaceId, teamId });
    await expect(
      database.db.delete(users).where(eq(users.id, userId)),
    ).rejects.toMatchObject({ cause: { code: "23001" } });
    await database.db.delete(teams).where(eq(teams.id, teamId));
    expect(await database.db.select().from(teamMembers)).toHaveLength(0);
    expect(await database.db.select().from(teamInvites)).toHaveLength(0);
    expect(await database.db.select().from(accessGrants)).toHaveLength(0);
  });

  it("cascades messages when their room is deleted", async () => {
    await database.db
      .insert(messages)
      .values({ roomId, seq: 1, body: "메시지" });
    await database.db.delete(chatRooms).where(eq(chatRooms.id, roomId));
    expect(await database.db.select().from(messages)).toHaveLength(0);
  });

  it("creates the maintenance GiST index from the declared schema", async () => {
    const result = await database.client.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'space_blocks_space_id_during_idx'",
    );
    expect(result.rows[0]?.indexdef).toContain("USING gist (space_id, during)");
  });
});
