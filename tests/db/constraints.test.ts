import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { eq, sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
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
  teamJoinRequests,
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
      {
        spaceId,
        userId,
        during,
        status: "cancelled",
        cancelledAt: during.start,
        cancelledBy: userId,
      },
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

  it("11. rejects team names that differ only by case", async () => {
    await database.db.insert(teams).values({ name: "Acme", createdBy: userId });
    await expect(
      database.db.insert(teams).values({ name: "aCME", createdBy: userId }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "teams_name_unique" },
    });
  });

  it.each([0, 1001])("12. rejects headcount %i", async (headcount) => {
    await expect(
      database.db
        .insert(teams)
        .values({ name: "크기 검사", createdBy: userId, headcount }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint: "teams_headcount_valid" },
    });
  });

  it.each([null, 1, 1000])(
    "12. permits nullable and boundary headcount %s",
    async (headcount) => {
      await expect(
        database.db
          .insert(teams)
          .values({ name: "크기 검사", createdBy: userId, headcount }),
      ).resolves.toBeDefined();
    },
  );

  it.each(["revokedAt", "declinedAt", "acceptedAt"] as const)(
    "13. permits another pending invite only after %s is set",
    async (field) => {
      const input = {
        teamId,
        email: "invited@example.test",
        createdBy: userId,
      };
      const [invite] = await database.db
        .insert(teamInvites)
        .values({ ...input, token: "first-token" })
        .returning();
      await expect(
        database.db
          .insert(teamInvites)
          .values({ ...input, token: "second-token" }),
      ).rejects.toMatchObject({
        cause: { code: "23505", constraint: "team_invites_one_pending" },
      });
      await database.db
        .update(teamInvites)
        .set({ [field]: new Date() })
        .where(eq(teamInvites.id, invite!.id));
      await expect(
        database.db
          .insert(teamInvites)
          .values({ ...input, token: "second-token" }),
      ).resolves.toBeDefined();
    },
  );

  it("13. keeps expired unprocessed invitations unique and permits null-email future link rows", async () => {
    const input = { teamId, email: "invited@example.test", createdBy: userId };
    await database.db
      .insert(teamInvites)
      .values({ ...input, token: "expired-token", expiresAt: new Date(0) });
    await expect(
      database.db
        .insert(teamInvites)
        .values({ ...input, token: "fresh-token" }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "team_invites_one_pending" },
    });
    await database.db.insert(teamInvites).values([
      { teamId, createdBy: userId, token: "link-a" },
      { teamId, createdBy: userId, token: "link-b" },
    ]);
  });

  it.each(["rejected", "cancelled", "approved"] as const)(
    "14. permits another pending request after the previous one is %s",
    async (status) => {
      const [request] = await database.db
        .insert(teamJoinRequests)
        .values({ teamId, userId })
        .returning();
      await expect(
        database.db.insert(teamJoinRequests).values({ teamId, userId }),
      ).rejects.toMatchObject({
        cause: { code: "23505", constraint: "team_join_requests_one_pending" },
      });
      await database.db
        .update(teamJoinRequests)
        .set({ status })
        .where(eq(teamJoinRequests.id, request!.id));
      await expect(
        database.db.insert(teamJoinRequests).values({ teamId, userId }),
      ).resolves.toBeDefined();
    },
  );

  it.each([
    { status: "cancelled" as const, cancelledAt: null },
    { status: "confirmed" as const, cancelledAt: during.start },
  ])(
    "15. rejects inconsistent cancellation audit fields: $status",
    async (audit) => {
      await expect(
        database.db
          .insert(bookings)
          .values({ spaceId, userId, during, ...audit }),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "bookings_cancel_consistent" },
      });
    },
  );

  it("15. permits matching cancellation timestamps and nullable historical actors", async () => {
    await database.db.insert(bookings).values([
      { spaceId, userId, during, status: "confirmed" },
      {
        spaceId,
        userId,
        during,
        status: "cancelled",
        cancelledAt: during.start,
      },
      {
        spaceId,
        userId,
        during,
        status: "cancelled",
        cancelledAt: during.end,
        cancelledBy: userId,
      },
    ]);
    const rows = await database.db.select().from(bookings);
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "confirmed", cancelledAt: null }),
        expect.objectContaining({
          status: "cancelled",
          cancelledAt: during.start,
          cancelledBy: null,
        }),
        expect.objectContaining({
          status: "cancelled",
          cancelledAt: during.end,
          cancelledBy: userId,
        }),
      ]),
    );
  });

  it("15. keeps cancellation actors referentially intact", async () => {
    const actorId = crypto.randomUUID();
    const input = {
      spaceId,
      userId,
      during,
      status: "cancelled" as const,
      cancelledAt: during.start,
      cancelledBy: actorId,
    };
    await expect(
      database.db.insert(bookings).values(input),
    ).rejects.toMatchObject({
      cause: { code: "23503", constraint: "bookings_cancelled_by_users_id_fk" },
    });
    await database.db.insert(users).values({
      id: actorId,
      email: "canceller@example.test",
      name: "취소한 사람",
    });
    await database.db.insert(bookings).values(input);
    await expect(
      database.db.delete(users).where(eq(users.id, actorId)),
    ).rejects.toMatchObject({
      cause: { code: "23001", constraint: "bookings_cancelled_by_users_id_fk" },
    });
  });

  it("16. clears a user's default branch when the branch is deleted", async () => {
    const defaultBranchId = crypto.randomUUID();
    await database.db.insert(branches).values({
      id: defaultBranchId,
      name: "기본 지점",
    });
    await database.db
      .update(users)
      .set({ defaultBranchId })
      .where(eq(users.id, userId));
    const [before] = await database.db
      .select()
      .from(users)
      .where(eq(users.id, userId));
    expect(before?.defaultBranchId).toBe(defaultBranchId);
    await database.db.delete(branches).where(eq(branches.id, defaultBranchId));
    const [after] = await database.db
      .select()
      .from(users)
      .where(eq(users.id, userId));
    expect(after?.defaultBranchId).toBeNull();
    expect(after?.id).toBe(userId);
  });

  it("16. rejects a default branch that does not exist", async () => {
    await expect(
      database.db
        .update(users)
        .set({ defaultBranchId: crypto.randomUUID() })
        .where(eq(users.id, userId)),
    ).rejects.toMatchObject({
      cause: {
        code: "23503",
        constraint: "users_default_branch_id_branches_id_fk",
      },
    });
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

describe("booking foundation upgrade", () => {
  it("backfills legacy cancelled rows before adding the cancellation check", async () => {
    const client = new PGlite({ extensions: { btree_gist } });
    try {
      const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
      const upgradeIndex = migrations.findIndex(({ sql }) =>
        sql.some((statement) =>
          statement.includes('ADD CONSTRAINT "bookings_cancel_consistent"'),
        ),
      );
      expect(upgradeIndex).toBeGreaterThan(0);
      for (const migration of migrations.slice(0, upgradeIndex)) {
        await client.transaction(async (transaction) => {
          for (const statement of migration.sql)
            await transaction.exec(statement);
        });
      }

      const userId = crypto.randomUUID();
      const branchId = crypto.randomUUID();
      const floorId = crypto.randomUUID();
      const spaceId = crypto.randomUUID();
      const createdAt = new Date("2026-10-01T03:04:05Z");
      await client.query(
        "INSERT INTO users (id, name, email) VALUES ($1, $2, $3)",
        [userId, "기존 사용자", "legacy@example.test"],
      );
      await client.query("INSERT INTO branches (id, name) VALUES ($1, $2)", [
        branchId,
        "기존 지점",
      ]);
      await client.query(
        "INSERT INTO floors (id, branch_id, level, name) VALUES ($1, $2, 7, '7F')",
        [floorId, branchId],
      );
      await client.query(
        "INSERT INTO spaces (id, floor_id, type, name) VALUES ($1, $2, 'meeting_room', '기존 공간')",
        [spaceId, floorId],
      );
      for (const status of ["cancelled", "confirmed"]) {
        await client.query(
          "INSERT INTO bookings (space_id, user_id, during, status, created_at) VALUES ($1, $2, tstzrange($3, $4, '[)'), $5, $6)",
          [spaceId, userId, during.start, during.end, status, createdAt],
        );
      }
      for (const migration of migrations.slice(upgradeIndex)) {
        await client.transaction(async (transaction) => {
          for (const statement of migration.sql)
            await transaction.exec(statement);
        });
      }

      const result = await client.query<{
        status: string;
        cancelled_at: Date | null;
        cancelled_by: string | null;
      }>(
        "SELECT status, cancelled_at, cancelled_by FROM bookings ORDER BY status",
      );
      expect(result.rows).toEqual([
        { status: "confirmed", cancelled_at: null, cancelled_by: null },
        { status: "cancelled", cancelled_at: createdAt, cancelled_by: null },
      ]);
      await expect(
        client.query(
          "UPDATE bookings SET cancelled_at = NULL WHERE status = 'cancelled'",
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "bookings_cancel_consistent",
      });
    } finally {
      await client.close();
    }
  });
});
