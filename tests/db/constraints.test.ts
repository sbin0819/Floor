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
  chatRooms,
  chatRoomMembers,
  chatSpaces,
  chatSpacePrefs,
  floorPlans,
  friendships,
  floors,
  messages,
  messageMentions,
  messageReactions,
  reports,
  roleSettings,
  spaces,
  teamInvites,
  teamJoinRequests,
  teamMembers,
  teams,
  users,
  userBlocks,
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
  let chatSpaceId: string;

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
    chatSpaceId = crypto.randomUUID();
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
    await database.db.insert(chatSpaces).values({
      id: chatSpaceId,
      kind: "community",
      name: "가상 커뮤니티",
      createdBy: userId,
    });
    await database.db.insert(chatRooms).values({
      id: roomId,
      kind: "text",
      spaceId: chatSpaceId,
      name: "일반",
    });
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

  it.each([
    "team_without_team",
    "team_with_branch",
    "team_with_name",
    "branch_without_branch",
    "branch_with_team",
    "branch_with_name",
    "community_without_name",
    "community_without_creator",
    "community_with_team",
    "community_with_branch",
  ] as const)(
    "8. rejects a space with invalid references: %s",
    async (fixture) => {
      const fixtures: Record<typeof fixture, typeof chatSpaces.$inferInsert> = {
        team_without_team: { kind: "team" },
        team_with_branch: { kind: "team", teamId, branchId },
        team_with_name: { kind: "team", teamId, name: "별도 이름" },
        branch_without_branch: { kind: "branch" },
        branch_with_team: { kind: "branch", branchId, teamId },
        branch_with_name: { kind: "branch", branchId, name: "별도 이름" },
        community_without_name: { kind: "community", createdBy: userId },
        community_without_creator: { kind: "community", name: "가상 커뮤니티" },
        community_with_team: {
          kind: "community",
          name: "가상 커뮤니티",
          createdBy: userId,
          teamId,
        },
        community_with_branch: {
          kind: "community",
          name: "가상 커뮤니티",
          createdBy: userId,
          branchId,
        },
      };
      await expect(
        database.db.insert(chatSpaces).values(fixtures[fixture]),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "chat_spaces_kind_ref" },
      });
    },
  );

  it("8. accepts each space kind and permits only one space for each team or branch", async () => {
    await database.db.insert(chatSpaces).values([
      { kind: "team", teamId },
      { kind: "branch", branchId },
      { kind: "community", name: "다른 커뮤니티", createdBy: userId },
    ]);
    await expect(
      database.db.insert(chatSpaces).values({ kind: "team", teamId }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "chat_spaces_team_unique" },
    });
    await expect(
      database.db.insert(chatSpaces).values({ kind: "branch", branchId }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "chat_spaces_branch_unique" },
    });
  });

  it("9. rejects duplicate room message sequence numbers", async () => {
    await database.db
      .insert(messages)
      .values({ roomId, seq: 1, authorId: userId, body: "첫 메시지" });
    await expect(
      database.db
        .insert(messages)
        .values({ roomId, seq: 1, authorId: userId, body: "중복 메시지" }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "messages_room_id_seq_unique" },
    });
  });

  it("9. rejects duplicate non-null client ids and permits multiple null client ids", async () => {
    await database.db.insert(messages).values([
      {
        roomId,
        seq: 1,
        authorId: userId,
        body: "첫 메시지",
        clientId: "retry-key",
      },
      { roomId, seq: 2, authorId: userId, body: "둘째 메시지" },
      { roomId, seq: 3, authorId: userId, body: "셋째 메시지" },
    ]);
    await expect(
      database.db.insert(messages).values({
        roomId,
        seq: 4,
        authorId: userId,
        body: "재전송",
        clientId: "retry-key",
      }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "messages_room_id_client_id_unique" },
    });
  });

  it("9. permits the same client id in different rooms", async () => {
    const secondRoomId = crypto.randomUUID();
    await database.db.insert(chatRooms).values({
      id: secondRoomId,
      kind: "text",
      spaceId: chatSpaceId,
      name: "다른 채널",
    });
    await database.db.insert(messages).values([
      {
        roomId,
        seq: 1,
        authorId: userId,
        body: "첫 방",
        clientId: "retry-key",
      },
      {
        roomId: secondRoomId,
        seq: 1,
        authorId: userId,
        body: "다른 방",
        clientId: "retry-key",
      },
    ]);
    expect(await database.db.select().from(messages)).toHaveLength(2);
  });

  it.each(["text", "system"] as const)(
    "9. rejects %s with the wrong author presence",
    async (kind) => {
      await expect(
        database.db.insert(messages).values({
          roomId,
          seq: 1,
          kind,
          authorId: kind === "system" ? userId : null,
          body: "작성자 검사",
          systemData:
            kind === "system"
              ? { type: "group_created", actorName: "테스트 사용자" }
              : null,
        }),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "messages_author_kind" },
      });
    },
  );

  it.each([0, 4001])("9. rejects invalid body length %i", async (length) => {
    await expect(
      database.db.insert(messages).values({
        roomId,
        seq: 1,
        authorId: userId,
        body: "가".repeat(length),
      }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint: "messages_body_length" },
    });
  });

  it("9. accepts a system message without an author and 4000 Unicode code points", async () => {
    await database.db.insert(messages).values([
      {
        roomId,
        seq: 1,
        kind: "system",
        body: "테스트 사용자 님이 그룹을 만들었어요",
        systemData: { type: "group_created", actorName: "테스트 사용자" },
      },
      { roomId, seq: 2, authorId: userId, body: "😀".repeat(4000) },
    ]);
    expect(await database.db.select().from(messages)).toHaveLength(2);
  });

  it.each(["text", "voice"] as const)(
    "10. rejects %s rooms missing their required reference",
    async (kind) => {
      await expect(
        database.db.insert(chatRooms).values({ kind }),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "chat_rooms_kind_ref" },
      });
    },
  );

  it.each(["text", "voice"] as const)(
    "10. requires both space and name for a %s channel",
    async (kind) => {
      for (const value of [
        { kind, spaceId: chatSpaceId },
        { kind, name: "새 채널" },
      ]) {
        await expect(
          database.db.insert(chatRooms).values(value),
        ).rejects.toMatchObject({
          cause: { code: "23514", constraint: "chat_rooms_kind_ref" },
        });
      }
    },
  );

  it("10. accepts channel names again after archival and allows the same name in another space", async () => {
    await database.db
      .insert(chatRooms)
      .values({ kind: "text", spaceId: chatSpaceId, name: "General" });
    await expect(
      database.db
        .insert(chatRooms)
        .values({ kind: "voice", spaceId: chatSpaceId, name: "gENERAL" }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "chat_rooms_space_name_unique" },
    });
    await database.db
      .update(chatRooms)
      .set({ archivedAt: new Date("2026-10-07T12:00:00Z") });
    await database.db
      .insert(chatRooms)
      .values({ kind: "text", spaceId: chatSpaceId, name: "gENERAL" });
    const secondSpaceId = crypto.randomUUID();
    await database.db
      .insert(chatSpaces)
      .values({ id: secondSpaceId, kind: "team", teamId });
    await database.db
      .insert(chatRooms)
      .values({ kind: "text", spaceId: secondSpaceId, name: "General" });
    expect(await database.db.select().from(chatRooms)).toHaveLength(4);
  });

  it.each([
    { name: "", topic: null },
    { name: "가".repeat(31), topic: null },
    { name: "채널", topic: "가".repeat(201) },
  ])(
    "10. rejects invalid channel name or topic length: $name",
    async (fields) => {
      await expect(
        database.db
          .insert(chatRooms)
          .values({ kind: "text", spaceId: chatSpaceId, ...fields }),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "chat_rooms_name_length" },
      });
    },
  );

  it("10. accepts 30-character channel names and 200-character topics", async () => {
    await database.db.insert(chatRooms).values({
      kind: "voice",
      spaceId: chatSpaceId,
      name: "😀".repeat(30),
      topic: "가".repeat(200),
    });
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

  it("17. rejects active space names that differ only by case on the same floor", async () => {
    await database.db
      .insert(spaces)
      .values({ floorId, type: "meeting_room", name: "Room Alpha" });
    await expect(
      database.db
        .insert(spaces)
        .values({ floorId, type: "phone_booth", name: "rOOM aLPHA" }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "spaces_floor_name_unique" },
    });
    await expect(
      database.db
        .update(spaces)
        .set({ name: "ROOM ALPHA" })
        .where(eq(spaces.id, otherSpaceId)),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "spaces_floor_name_unique" },
    });
  });

  it("17. reuses archived names but rejects restoring a conflicting active name", async () => {
    const archivedId = crypto.randomUUID();
    await database.db.insert(spaces).values({
      id: archivedId,
      floorId,
      type: "meeting_room",
      name: "Room Alpha",
    });
    await database.db
      .update(spaces)
      .set({ archivedAt: during.start })
      .where(eq(spaces.id, archivedId));
    await expect(
      database.db
        .insert(spaces)
        .values({ floorId, type: "meeting_room", name: "room alpha" }),
    ).resolves.toBeDefined();
    await expect(
      database.db
        .update(spaces)
        .set({ archivedAt: null })
        .where(eq(spaces.id, archivedId)),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "spaces_floor_name_unique" },
    });
  });

  it("17. permits the same active name on different floors", async () => {
    const otherFloorId = crypto.randomUUID();
    await database.db
      .insert(floors)
      .values({ id: otherFloorId, branchId, level: 8, name: "8F" });
    await expect(
      database.db.insert(spaces).values([
        { floorId, type: "meeting_room", name: "Room Alpha" },
        { floorId: otherFloorId, type: "meeting_room", name: "ROOM ALPHA" },
      ]),
    ).resolves.toBeDefined();
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
      .values({ roomId, seq: 1, authorId: userId, body: "메시지" });
    await database.db.delete(chatRooms).where(eq(chatRooms.id, roomId));
    expect(await database.db.select().from(messages)).toHaveLength(0);
  });

  it("25. permits only empty bodies for deleted messages and nonempty live bodies", async () => {
    for (const value of [
      { body: "", deletedAt: null },
      { body: "남은 본문", deletedAt: during.start },
    ]) {
      await expect(
        database.db.insert(messages).values({
          roomId,
          authorId: userId,
          seq: 1,
          ...value,
        }),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "messages_body_length" },
      });
    }
    await database.db.insert(messages).values([
      { roomId, authorId: userId, seq: 1, body: "정상 메시지" },
      {
        roomId,
        authorId: userId,
        seq: 2,
        body: "",
        deletedAt: during.start,
        deletedBy: userId,
      },
    ]);
    expect(await database.db.select().from(messages)).toHaveLength(2);
  });

  it("26. enforces reaction uniqueness and enum and cascades reaction/mention rows", async () => {
    const [message] = await database.db
      .insert(messages)
      .values({
        roomId,
        authorId: userId,
        seq: 1,
        body: "리액션",
      })
      .returning();
    if (!message) throw new Error("Missing message fixture");
    const reaction = { messageId: message.id, userId, emoji: "heart" as const };
    await database.db.insert(messageReactions).values(reaction);
    await expect(
      database.db.insert(messageReactions).values(reaction),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
    await database.db
      .insert(messageReactions)
      .values({ ...reaction, emoji: "thumbs_up" });
    expect(await database.db.select().from(messageReactions)).toHaveLength(2);
    await expect(
      database.db.execute(
        sql`INSERT INTO message_reactions (message_id, user_id, emoji) VALUES (${message.id}, ${userId}, 'invalid')`,
      ),
    ).rejects.toMatchObject({ cause: { code: "22P02" } });
    await database.db
      .insert(messageMentions)
      .values({ messageId: message.id, userId });
    await database.db.delete(messages).where(eq(messages.id, message.id));
    expect(await database.db.select().from(messageReactions)).toHaveLength(0);
    expect(await database.db.select().from(messageMentions)).toHaveLength(0);
  });

  it("27. enforces mention and space preference uniqueness", async () => {
    const [message] = await database.db
      .insert(messages)
      .values({
        roomId,
        authorId: userId,
        seq: 1,
        body: "멘션",
      })
      .returning();
    if (!message) throw new Error("Missing message fixture");
    const mention = { messageId: message.id, userId };
    await database.db.insert(messageMentions).values(mention);
    await expect(
      database.db.insert(messageMentions).values(mention),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
    const preference = {
      spaceId: chatSpaceId,
      userId,
      updatedAt: during.start,
    };
    await database.db.insert(chatSpacePrefs).values(preference);
    await expect(
      database.db.insert(chatSpacePrefs).values(preference),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("keeps replies but clears their reference when the original row is removed", async () => {
    const [original] = await database.db
      .insert(messages)
      .values({
        roomId,
        authorId: userId,
        seq: 1,
        body: "원문",
      })
      .returning();
    if (!original) throw new Error("Missing original fixture");
    await database.db.insert(messages).values({
      roomId,
      authorId: userId,
      seq: 2,
      body: "답장",
      replyToId: original.id,
    });
    await database.db.delete(messages).where(eq(messages.id, original.id));
    expect(
      await database.db
        .select({ replyToId: messages.replyToId })
        .from(messages),
    ).toEqual([{ replyToId: null }]);
    const index = await database.client.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'messages_everyone_idx'",
    );
    expect(index.rows[0]?.indexdef).toContain("(room_id, seq)");
    expect(index.rows[0]?.indexdef).toContain(
      "WHERE (mentions_everyone AND (deleted_at IS NULL))",
    );
  });

  it("creates the maintenance GiST index from the declared schema", async () => {
    const result = await database.client.query<{ indexdef: string }>(
      "SELECT indexdef FROM pg_indexes WHERE indexname = 'space_blocks_space_id_during_idx'",
    );
    expect(result.rows[0]?.indexdef).toContain("USING gist (space_id, during)");
  });
  it.each(["ab", "a".repeat(21), "Subin", "su bin", "수빈"])(
    "28. rejects invalid username %s",
    async (username) => {
      await expect(
        database.db.update(users).set({ username }).where(eq(users.id, userId)),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "users_username_format" },
      });
    },
  );

  it("28. permits null names and enforces valid username uniqueness", async () => {
    const otherId = crypto.randomUUID();
    await database.db
      .insert(users)
      .values({ id: otherId, name: "다른 회원", email: "other@floor.test" });
    expect(
      (
        await database.db.select({ username: users.username }).from(users)
      ).every((row) => row.username === null),
    ).toBe(true);
    await database.db
      .update(users)
      .set({ username: "sub.in_1" })
      .where(eq(users.id, userId));
    await expect(
      database.db
        .update(users)
        .set({ username: "sub.in_1" })
        .where(eq(users.id, otherId)),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "users_username_unique" },
    });
  });

  async function peoplePair() {
    const otherId = crypto.randomUUID();
    await database.db
      .insert(users)
      .values({ id: otherId, name: "상대", email: `${otherId}@floor.test` });
    const [low, high] = [userId, otherId].sort() as [string, string];
    return { low, high };
  }

  it("29. enforces friendship order, requester and pair uniqueness", async () => {
    const { low, high } = await peoplePair();
    const relation = {
      userLowId: low,
      userHighId: high,
      requestedBy: low,
      status: "pending" as const,
      requestedAt: during.start,
      statusChangedAt: during.start,
    };
    for (const ids of [
      { userLowId: high, userHighId: low },
      { userLowId: low, userHighId: low },
    ]) {
      await expect(
        database.db.insert(friendships).values({ ...relation, ...ids }),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "friendships_order" },
      });
    }
    await expect(
      database.db
        .insert(friendships)
        .values({ ...relation, requestedBy: crypto.randomUUID() }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint: "friendships_requester" },
    });
    await database.db.insert(friendships).values(relation);
    await expect(
      database.db.insert(friendships).values(relation),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
  });

  it("30. requires ordered DM peers without a space or name and keeps one room per pair", async () => {
    const { low, high } = await peoplePair();
    const room = { kind: "dm" as const, dmLowUserId: low, dmHighUserId: high };
    for (const invalid of [
      { kind: "dm" as const },
      { ...room, dmLowUserId: null },
      { ...room, dmHighUserId: null },
      { ...room, dmLowUserId: high, dmHighUserId: low },
      { ...room, dmHighUserId: low },
      { ...room, spaceId: chatSpaceId },
      { ...room, name: "금지 이름" },
      {
        ...room,
        kind: "text" as const,
        spaceId: chatSpaceId,
        name: "금지 채널",
      },
      {
        ...room,
        kind: "voice" as const,
        spaceId: chatSpaceId,
        name: "금지 음성",
      },
    ])
      await expect(
        database.db.insert(chatRooms).values(invalid),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "chat_rooms_kind_ref" },
      });
    await database.db.insert(chatRooms).values(room);
    await expect(
      database.db.insert(chatRooms).values(room),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "chat_rooms_dm_pair_unique" },
    });
    await database.db
      .insert(chatRooms)
      .values([{ kind: "group_dm" }, { kind: "meeting" }]);
  });

  it("31. makes room memberships unique and cascades room deletion", async () => {
    const { low, high } = await peoplePair();
    const [room] = await database.db
      .insert(chatRooms)
      .values({ kind: "dm", dmLowUserId: low, dmHighUserId: high })
      .returning();
    const member = {
      roomId: room!.id,
      userId: low,
      status: "active" as const,
      joinedAt: during.start,
      statusChangedAt: during.start,
    };
    await database.db.insert(chatRoomMembers).values(member);
    await expect(
      database.db.insert(chatRoomMembers).values(member),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
    await database.db.delete(chatRooms).where(eq(chatRooms.id, room!.id));
    expect(await database.db.select().from(chatRoomMembers)).toEqual([]);
  });

  it("32. rejects self and duplicate blocks but permits the reverse direction", async () => {
    const { low, high } = await peoplePair();
    await expect(
      database.db.insert(userBlocks).values({ blockerId: low, blockedId: low }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint: "user_blocks_not_self" },
    });
    await database.db
      .insert(userBlocks)
      .values({ blockerId: low, blockedId: high });
    await expect(
      database.db
        .insert(userBlocks)
        .values({ blockerId: low, blockedId: high }),
    ).rejects.toMatchObject({ cause: { code: "23505" } });
    await database.db
      .insert(userBlocks)
      .values({ blockerId: high, blockedId: low });
    expect(await database.db.select().from(userBlocks)).toHaveLength(2);
  });

  it("33. enforces message report uniqueness and Unicode detail length while retaining reports after message deletion", async () => {
    const { low, high } = await peoplePair();
    const [message] = await database.db
      .insert(messages)
      .values({ roomId, seq: 1, authorId: high, body: "검사 메시지" })
      .returning();
    const report = {
      reporterId: low,
      targetUserId: high,
      messageId: message!.id,
      reason: "spam" as const,
      detail: "😀".repeat(500),
    };
    await database.db.insert(reports).values(report);
    await expect(
      database.db.insert(reports).values(report),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "reports_message_unique" },
    });
    await database.db.insert(reports).values([
      { ...report, messageId: null },
      { ...report, messageId: null },
    ]);
    await expect(
      database.db
        .insert(reports)
        .values({ ...report, messageId: null, detail: "😀".repeat(501) }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint: "reports_detail_length" },
    });
    await database.db.delete(messages).where(eq(messages.id, message!.id));
    expect(
      (await database.db.select().from(reports)).map((row) => row.messageId),
    ).toEqual([null, null, null]);
  });

  it("34. accepts unnamed group rooms but rejects space and private pair references", async () => {
    const [room] = await database.db
      .insert(chatRooms)
      .values({ kind: "group_dm" })
      .returning();
    expect(room?.name).toBeNull();
    for (const ref of [
      { spaceId: chatSpaceId },
      { dmLowUserId: userId },
      { dmHighUserId: userId },
    ]) {
      await expect(
        database.db.insert(chatRooms).values({ kind: "group_dm", ...ref }),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "chat_rooms_kind_ref" },
      });
    }
  });

  it.each(["requested", "declined"] as const)(
    "34. requires a request timestamp for %s memberships",
    async (status) => {
      const member = {
        roomId,
        userId,
        status,
        joinedAt: during.start,
        statusChangedAt: during.start,
      };
      await expect(
        database.db.insert(chatRoomMembers).values(member),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "chat_room_members_requested" },
      });
      await database.db
        .insert(chatRoomMembers)
        .values({ ...member, requestedAt: during.start });
      expect(
        (await database.db.select().from(chatRoomMembers))[0]?.requestedAt,
      ).toEqual(during.start);
    },
  );

  it.each(["active", "left"] as const)(
    "34. allows %s memberships without a request timestamp",
    async (status) => {
      await database.db
        .insert(chatRoomMembers)
        .values({
          roomId,
          userId,
          status,
          joinedAt: during.start,
          statusChangedAt: during.start,
        });
      expect(
        (await database.db.select().from(chatRoomMembers))[0]?.requestedAt,
      ).toBeNull();
    },
  );

  it.each(["system", "text"] as const)(
    "35. requires system data exactly for system messages, not %s with mismatched data",
    async (kind) => {
      await expect(
        database.db
          .insert(messages)
          .values({
            roomId,
            seq: 1,
            kind,
            authorId: kind === "system" ? null : userId,
            body: "검사",
            systemData:
              kind === "system"
                ? null
                : { type: "group_created", actorName: "테스트" },
          }),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "messages_system_data" },
      });
      await database.db
        .insert(messages)
        .values({
          roomId,
          seq: 1,
          kind,
          authorId: kind === "system" ? null : userId,
          body: "검사",
          systemData:
            kind === "system"
              ? { type: "group_created", actorName: "테스트" }
              : null,
        });
      expect(await database.db.select().from(messages)).toHaveLength(1);
    },
  );
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
      expect(
        (
          await client.query(
            "SELECT username, username_changed_at, status FROM users WHERE id = $1",
            [userId],
          )
        ).rows,
      ).toEqual([
        { username: null, username_changed_at: null, status: "online" },
      ]);
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
