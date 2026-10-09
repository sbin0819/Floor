import { eq } from "drizzle-orm";
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
import { createReportsQueries } from "@/features/admin/reports-query-factory";
import { createAdminShellQueries } from "@/features/admin/admin-shell-query-factory";
import { createAdminDashboardQueries } from "@/features/admin/dashboard-query-factory";
import { createSpaceMemberQueries } from "@/features/chat/space-members-queries";
import type { GetBranchReportsInput } from "@/features/admin/reports-schema";
import { ActionError } from "@/lib/actions/result";
import { createBranchLounge, createTeamSpace } from "@/lib/dal/chat-write";
import { createMeetingRoom } from "@/lib/dal/chat-meeting";
import * as reportRead from "@/lib/dal/reports-read";
import * as memberRead from "@/lib/dal/chat-space-members";
import {
  branchStaff,
  chatRooms,
  chatSpaceMembers,
  chatSpaces,
  messageMentions,
  messages,
  reports,
  roleSettings,
  users,
} from "@/lib/db/schema";
import {
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("branch report reads, summaries and lounge bans", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  let meter: ReturnType<typeof createQueryMeter>;
  beforeAll(async () => {
    database = await createTestDatabase();
    meter = createQueryMeter(database.client);
  });
  beforeEach(async () => {
    actors = await seedBookingActors(database);
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    meter.restore();
    await database.client.close();
  });
  const deps = (session = actors.operator) => ({
    database: database.db,
    requireSession: async () => session,
    now: () => bookingNow,
  });
  const query = (session = actors.operator) =>
    createReportsQueries(deps(session));
  const read = (tab: "open" | "resolved" = "open") =>
    query().getBranchReports({ branchId: actors.branchId, tab });
  async function lounge(branchId = actors.branchId) {
    const { spaceId } = await createBranchLounge(branchId, database.db);
    const rooms = await database.db
      .select()
      .from(chatRooms)
      .where(eq(chatRooms.spaceId, spaceId));
    return {
      spaceId,
      roomId: rooms.find((room) => room.name === "라운지")!.id,
      voiceId: rooms.find((room) => room.kind === "voice")!.id,
    };
  }
  async function message(
    roomId: string,
    seq = 1,
    overrides: Partial<typeof messages.$inferInsert> = {},
  ) {
    const [row] = await database.db
      .insert(messages)
      .values({
        roomId,
        seq,
        authorId: actors.person.userId,
        body: "신고 대상",
        createdAt: bookingNow,
        ...overrides,
      })
      .returning();
    return row!;
  }
  async function report(
    messageId: string | null,
    overrides: Partial<typeof reports.$inferInsert> = {},
  ) {
    const [row] = await database.db
      .insert(reports)
      .values({
        reporterId: actors.member.userId,
        targetUserId: actors.person.userId,
        messageId,
        reason: "spam",
        createdAt: bookingNow,
        ...overrides,
      })
      .returning();
    return row!;
  }
  async function meeting(spaceId = actors.publicSpaceId) {
    const booking = await insertFixtureBooking(database, actors, {
      spaceId,
      during: bookingRange("15:00", "16:00"),
    });
    return (
      await createMeetingRoom(
        { bookingId: booking.id, now: bookingNow },
        database.db,
      )
    ).id;
  }
  async function member(
    spaceId: string,
    userId: string,
    status: "active" | "banned" = "active",
  ) {
    await database.db.insert(chatSpaceMembers).values({
      spaceId,
      userId,
      status,
      joinedAt: bookingNow,
      statusChangedAt: bookingNow,
    });
  }
  it("checks session and strict input before any SQL", async () => {
    meter.start();
    const subject = createReportsQueries({
      ...deps(),
      requireSession: async () => {
        throw new ActionError("UNAUTHENTICATED");
      },
    });
    await expect(
      subject.getBranchReports({ branchId: "bad" }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    for (const input of [
      { branchId: "bad" },
      { branchId: actors.branchId, tab: "all" },
      { branchId: actors.branchId, reporterId: actors.person.userId },
    ])
      await expect(
        query().getBranchReports(input as GetBranchReportsInput),
      ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(meter.stop().statements).toBe(0);
  });
  it.each(["person", "otherOperator"] as const)(
    "hides branch/report metadata from %s without fetching report rows",
    async (actor) => {
      const list = vi.spyOn(reportRead, "listBranchReportGroups"),
        count = vi.spyOn(reportRead, "readOpenReportSummary");
      await expect(
        query(actors[actor]).getBranchReports({ branchId: actors.branchId }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(list).not.toHaveBeenCalled();
      expect(count).not.toHaveBeenCalled();
      await expect(
        reportRead.readReportBranch(
          { branchId: actors.branchId, userId: actors[actor].userId },
          database.db,
        ),
      ).resolves.toBeNull();
    },
  );
  it("requires branch.announce but neither lounge membership nor booking/chat permissions", async () => {
    const room = await lounge();
    await report((await message(room.roomId)).id);
    await database.db
      .insert(roleSettings)
      .values({ branchId: actors.branchId, role: "operator", permissions: [] });
    const list = vi.spyOn(reportRead, "listBranchReportGroups");
    await expect(read()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(list).not.toHaveBeenCalled();
    await database.db
      .update(roleSettings)
      .set({ permissions: ["branch.announce"] })
      .where(eq(roleSettings.branchId, actors.branchId));
    expect((await read()).rows).toHaveLength(1);
  });
  it("uses one branch scope for lounge/voice/meeting and excludes other branches, DMs, groups, teams, communities and user-only reports", async () => {
    const own = await lounge(),
      other = await lounge(actors.otherBranchId);
    const ownMeeting = await meeting(),
      otherMeeting = await meeting(actors.otherSpaceId);
    const team = await createTeamSpace(actors.teamId, database.db);
    const [community] = await database.db
      .insert(chatSpaces)
      .values({
        kind: "community",
        name: "비공개 커뮤니티",
        createdBy: actors.person.userId,
      })
      .returning();
    const sorted = [actors.person.userId, actors.member.userId].sort();
    const extra = await database.db
      .insert(chatRooms)
      .values([
        { kind: "dm", dmLowUserId: sorted[0]!, dmHighUserId: sorted[1]! },
        { kind: "group_dm", name: "비공개 그룹" },
        { kind: "text", name: "일반", spaceId: community!.id },
      ])
      .returning();
    const accepted: string[] = [];
    for (const roomId of [
      own.roomId,
      own.voiceId,
      ownMeeting,
      other.roomId,
      otherMeeting,
      team.roomId!,
      ...extra.map(({ id }) => id),
    ]) {
      const row = await message(roomId, 1, { body: `본문 ${roomId}` });
      await report(row.id);
      if ([own.roomId, own.voiceId, ownMeeting].includes(roomId))
        accepted.push(row.id);
    }
    await report(null);
    const data = await read();
    expect(data.rows.map(({ messageId }) => messageId).sort()).toEqual(
      accepted.sort(),
    );
    expect(data.reportSummary).toEqual({
      count: 3,
      oldestAt: bookingNow.toISOString(),
    });
    expect(
      data.rows.find(({ roomKind }) => roomKind === "meeting")?.roomLabel,
    ).toBe("회의실 B · 10월 7일 회의");
    expect(
      data.rows.find(({ roomKind }) => roomKind === "meeting")?.canBan,
    ).toBe(false);
    const scope = {
      branchId: actors.branchId,
      userId: actors.otherOperator.userId,
    };
    expect(await reportRead.readOpenReportSummary(scope, database.db)).toEqual({
      count: 0,
      oldestAt: null,
    });
    expect(
      await reportRead.listBranchReportGroups(
        { ...scope, tab: "open", now: bookingNow, cutoff: bookingNow },
        database.db,
      ),
    ).toEqual([]);
  });
  it("groups open reasons and details with oldest-first ordering, emits only public author data and sanitizes mentions including code", async () => {
    const { roomId } = await lounge();
    const early = new Date("2026-10-06T20:00:00Z");
    const unknown = crypto.randomUUID();
    const target = await message(roomId, 1, {
      body: `**<@${actors.person.userId}>** <@${actors.admin.userId}> <@everyone> \`<@${unknown}>\``,
    });
    await database.db
      .insert(messageMentions)
      .values({ messageId: target.id, userId: actors.admin.userId });
    await report(target.id, { detail: "설명 하나", createdAt: early });
    await report(target.id, {
      reporterId: actors.otherMember.userId,
      reason: "spam",
      detail: "설명 둘",
    });
    await report(target.id, {
      reporterId: actors.stranger.userId,
      reason: "harassment",
      detail: null,
    });
    const second = await message(roomId, 2);
    await report(second.id);
    const result = await read();
    const row = result.rows[0]!;
    expect(row).toMatchObject({
      messageId: target.id,
      count: 3,
      oldestAt: early.toISOString(),
      details: ["설명 하나", "설명 둘"],
      reasons: [
        { reason: "spam", count: 2 },
        { reason: "harassment", count: 1 },
      ],
      author: { name: actors.person.name, username: null },
      canBan: true,
    });
    expect(row.body).toBe(
      `**@${actors.person.name}** @${actors.admin.name} @모두 \`@알 수 없는 사용자\``,
    );
    expect(result.reportSummary).toEqual({
      count: 2,
      oldestAt: early.toISOString(),
    });
    expect(Object.keys(row.author).sort()).toEqual([
      "avatar",
      "name",
      "username",
    ]);
    const json = JSON.stringify(result);
    for (const actor of [
      actors.person,
      actors.member,
      actors.otherMember,
      actors.stranger,
      actors.admin,
    ]) {
      expect(json).not.toContain(actor.userId);
      expect(json).not.toContain(actor.email);
    }
    expect(json).not.toContain(unknown);
    expect(json).not.toContain("reporter");
    expect(json).not.toContain("reportedUserId");
  });
  it("selects exactly the last two live text messages before a lounge target and never exposes meeting history", async () => {
    const { roomId } = await lounge();
    await message(roomId, 1, { body: "너무 오래된 문맥" });
    await message(roomId, 2, {
      body: "첫 번째 문맥",
      authorId: actors.admin.userId,
    });
    const deletedContext = await message(roomId, 3, { body: "지운 문맥 비밀" });
    await database.db
      .update(messages)
      .set({ body: "", deletedAt: bookingNow, deletedBy: actors.person.userId })
      .where(eq(messages.id, deletedContext.id));
    await message(roomId, 4, {
      body: "시스템 비밀",
      kind: "system",
      authorId: null,
      systemData: { type: "group_created", actorName: "시스템" },
    });
    const prior = await message(roomId, 5, {
      body: `<@${actors.admin.userId}> ${"😀".repeat(50)}`,
    });
    await database.db
      .insert(messageMentions)
      .values({ messageId: prior.id, userId: actors.admin.userId });
    const target = await message(roomId, 6);
    await report(target.id);
    await message(roomId, 7, { body: "나중 문맥 비밀" });
    const meetingId = await meeting();
    await message(meetingId, 1, { body: "회의 문맥 비밀" });
    const meetingTarget = await message(meetingId, 2);
    await report(meetingTarget.id);
    const result = await read();
    const context = result.rows.find(
      ({ messageId }) => messageId === target.id,
    )!.context;
    expect(context).toHaveLength(2);
    expect(context[0]).toEqual({
      authorName: actors.admin.name,
      excerpt: "첫 번째 문맥",
    });
    expect(context[1]!.excerpt).toMatch(/^@그로스 관리자 /);
    expect(Array.from(context[1]!.excerpt)).toHaveLength(40);
    expect(
      result.rows.find(({ messageId }) => messageId === meetingTarget.id)!
        .context,
    ).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/비밀|너무 오래된/);
  });
  it("keeps a deleted target report but never returns the old body", async () => {
    const { roomId } = await lounge();
    const target = await message(roomId, 1, { body: "삭제된 본문 비밀" });
    await database.db
      .update(messages)
      .set({ body: "", deletedAt: bookingNow, deletedBy: actors.person.userId })
      .where(eq(messages.id, target.id));
    await report(target.id);
    const result = await read();
    expect(result.rows[0]).toMatchObject({
      deleted: true,
      body: "지운 메시지",
    });
    expect(JSON.stringify(result)).not.toContain("본문 비밀");
  });
  it("derives canBan from current branch permissions even for departed staff, protects self, and does not trust a stored member role", async () => {
    const { roomId, spaceId } = await lounge();
    await database.db.insert(branchStaff).values({
      branchId: actors.branchId,
      userId: actors.otherOperator.userId,
    });
    await member(spaceId, actors.person.userId);
    await database.db
      .update(chatSpaceMembers)
      .set({ role: "admin" })
      .where(eq(chatSpaceMembers.userId, actors.person.userId));
    for (const [index, actor] of [
      actors.person,
      actors.operator,
      actors.otherOperator,
    ].entries())
      await report(
        (await message(roomId, index + 1, { authorId: actor.userId })).id,
      );
    let data = await read();
    expect(
      data.rows.find((row) => row.author.name === actors.person.name)?.canBan,
    ).toBe(true);
    expect(
      data.rows
        .filter((row) => row.author.name !== actors.person.name)
        .every((row) => !row.canBan),
    ).toBe(true);
    await database.db.insert(roleSettings).values({
      branchId: actors.branchId,
      role: "user",
      permissions: ["branch.announce"],
    });
    data = await read();
    expect(data.rows.every((row) => !row.canBan)).toBe(true);
  });
  it("groups each historical resolution separately with a branch-local 30-day boundary and max 50 groups", async () => {
    const { roomId } = await lounge();
    const target = await message(roomId);
    await report(target.id, {
      resolvedAt: new Date("2026-10-01T03:00Z"),
      resolvedBy: actors.operator.userId,
      resolution: "dismissed",
    });
    await report(target.id, {
      reporterId: actors.otherMember.userId,
      resolvedAt: new Date("2026-10-02T03:00Z"),
      resolvedBy: actors.operator.userId,
      resolution: "message_deleted",
    });
    let result = await read("resolved");
    expect(result.rows.map(({ resolution }) => resolution)).toEqual([
      "message_deleted",
      "dismissed",
    ]);
    expect(result.rows.every(({ messageId }) => messageId === target.id)).toBe(
      true,
    );
    expect(result.rows[0]).toMatchObject({
      resolvedByName: actors.operator.name,
      resolvedAt: "2026-10-02T03:00:00.000Z",
      canBan: false,
    });
    const boundary = await message(roomId, 2);
    await report(boundary.id, {
      resolvedAt: new Date("2026-09-06T15:00Z"),
      resolvedBy: actors.operator.userId,
      resolution: "dismissed",
    });
    const outside = await message(roomId, 3);
    await report(outside.id, {
      resolvedAt: new Date("2026-09-06T14:59:59.999Z"),
      resolvedBy: actors.operator.userId,
      resolution: "dismissed",
    });
    result = await read("resolved");
    expect(result.rows.map(({ messageId }) => messageId)).toContain(
      boundary.id,
    );
    expect(result.rows.map(({ messageId }) => messageId)).not.toContain(
      outside.id,
    );
    const many = await database.db
      .insert(messages)
      .values(
        Array.from({ length: 55 }, (_, index) => ({
          roomId,
          seq: index + 10,
          authorId: actors.person.userId,
          body: `과거 ${index}`,
        })),
      )
      .returning();
    await database.db.insert(reports).values(
      many.map((row, index) => ({
        messageId: row.id,
        reporterId: actors.member.userId,
        targetUserId: actors.person.userId,
        reason: "other" as const,
        resolvedAt: new Date(bookingNow.getTime() - index * 1000),
        resolvedBy: actors.operator.userId,
        resolution: "dismissed" as const,
      })),
    );
    result = await read("resolved");
    expect(result.rows).toHaveLength(50);
    expect(result.rows.map(({ resolvedAt }) => resolvedAt)).toEqual(
      result.rows
        .map(({ resolvedAt }) => resolvedAt)
        .sort()
        .reverse(),
    );
  });
  it("keeps reports [4,2], sidebar [4,1] and dashboard [6,4] independent of report count and selected floor/date", async () => {
    const { roomId } = await lounge();
    const target = await message(roomId);
    await report(target.id);
    const otherRoom = await meeting(actors.restrictedFloorSpaceId);
    await report((await message(otherRoom)).id);
    for (const count of [0, 30]) {
      if (count) {
        const more = await database.db
          .insert(messages)
          .values(
            Array.from({ length: count }, (_, i) => ({
              roomId,
              seq: i + 10,
              authorId: actors.person.userId,
              body: "추가 신고",
            })),
          )
          .returning();
        await database.db.insert(reports).values(
          more.map(({ id }) => ({
            messageId: id,
            reporterId: actors.member.userId,
            targetUserId: actors.person.userId,
            reason: "spam" as const,
            createdAt: bookingNow,
          })),
        );
      }
      meter.start();
      const listing = await read();
      expect(meter.stop()).toEqual({
        stages: 2,
        statements: 6,
        perStage: [4, 2],
      });
      meter.start();
      const shell = await createAdminShellQueries(deps()).getAdminShell(
        actors.branchId,
      );
      expect(meter.stop()).toEqual({
        stages: 2,
        statements: 5,
        perStage: [4, 1],
      });
      meter.start();
      const dashboard = await createAdminDashboardQueries(
        deps(),
      ).getAdminDashboard({
        branchId: actors.branchId,
        floorId: actors.floorId,
        date: "2026-10-01",
        range: "week",
      });
      expect(meter.stop()).toEqual({
        stages: 2,
        statements: 10,
        perStage: [6, 4],
      });
      expect(listing.reportSummary?.count).toBe(count + 2);
      expect(shell.branches[0]!.reportSummary).toEqual(listing.reportSummary);
      expect(dashboard.reportSummary).toEqual(listing.reportSummary);
      expect(dashboard.cards).not.toHaveProperty("reportSummary");
    }
  });
  it("omits report SQL completely from both summaries without branch.announce", async () => {
    await database.db.insert(roleSettings).values({
      branchId: actors.branchId,
      role: "operator",
      permissions: ["stats.view", "space.manage"],
    });
    const run = vi.spyOn(database.client, "query");
    const shell = await createAdminShellQueries(deps()).getAdminShell(
      actors.branchId,
    );
    const dashboard = await createAdminDashboardQueries(
      deps(),
    ).getAdminDashboard({ branchId: actors.branchId });
    expect(shell.branches[0]!.reportSummary).toBeNull();
    expect(dashboard.reportSummary).toBeNull();
    expect(shell.branches[0]!.menus).not.toContain("reports");
    expect(run.mock.calls.map(([text]) => text).join(" ")).not.toMatch(
      /\breports\b/,
    );
  });
  it("keeps each sidebar branch summary independently permission-scoped", async () => {
    const own = await lounge(),
      other = await lounge(actors.otherBranchId);
    await report((await message(own.roomId)).id);
    await report((await message(other.roomId)).id);
    await database.db
      .insert(branchStaff)
      .values({
        branchId: actors.otherBranchId,
        userId: actors.operator.userId,
      });
    await database.db
      .insert(roleSettings)
      .values({
        branchId: actors.otherBranchId,
        role: "operator",
        permissions: ["space.manage"],
      });
    meter.start();
    const result = await createAdminShellQueries(deps()).getAdminShell(
      actors.branchId,
    );
    expect(meter.stop()).toEqual({
      stages: 2,
      statements: 5,
      perStage: [4, 1],
    });
    expect(
      result.branches.find(({ id }) => id === actors.branchId)?.reportSummary,
    ).toEqual({ count: 1, oldestAt: bookingNow.toISOString() });
    expect(
      result.branches.find(({ id }) => id === actors.otherBranchId)
        ?.reportSummary,
    ).toBeNull();
  });
  it("exposes active and banned lounge members only to the actual lounge administrator in [1,1]", async () => {
    const { spaceId } = await lounge();
    await member(spaceId, actors.operator.userId);
    await member(spaceId, actors.person.userId);
    await member(spaceId, actors.stranger.userId, "banned");
    const subject = (session = actors.operator) =>
      createSpaceMemberQueries(deps(session)).getSpaceMembers(spaceId);
    meter.start();
    const full = await subject();
    expect(meter.stop()).toEqual({
      stages: 2,
      statements: 2,
      perStage: [1, 1],
    });
    expect(full).toMatchObject({ view: "full", memberCount: 2 });
    if (full?.view !== "full") throw new Error("Expected full view");
    expect(full.members.map(({ userId }) => userId).sort()).toEqual(
      [actors.operator.userId, actors.person.userId].sort(),
    );
    expect(full.banned.map(({ userId }) => userId)).toEqual([
      actors.stranger.userId,
    ]);
    expect(Object.keys(full.banned[0]!).sort()).toEqual([
      "avatar",
      "name",
      "role",
      "sharesSpace",
      "userId",
      "username",
    ]);
    const limited = await subject(actors.person);
    expect(limited).toMatchObject({
      view: "limited",
      admins: [{ userId: actors.operator.userId }],
    });
    expect(JSON.stringify(limited)).not.toContain(actors.stranger.userId);
    expect(JSON.stringify(full)).not.toContain(actors.stranger.email);
    expect(await subject(actors.stranger)).toBeNull();
  });
  it("preserves the separate 200-person cap for each lounge list", async () => {
    const { spaceId } = await lounge();
    await member(spaceId, actors.operator.userId);
    const extra = Array.from({ length: 405 }, (_, i) => ({
      id: crypto.randomUUID(),
      name: `사용자${String(i).padStart(3, "0")}`,
      email: `extra${i}@example.test`,
    }));
    await database.db.insert(users).values(extra);
    await database.db.insert(chatSpaceMembers).values(
      extra.map((row, i) => ({
        spaceId,
        userId: row.id,
        status: i < 202 ? ("active" as const) : ("banned" as const),
        joinedAt: bookingNow,
        statusChangedAt: bookingNow,
      })),
    );
    const result =
      await createSpaceMemberQueries(deps()).getSpaceMembers(spaceId);
    if (result?.view !== "full") throw new Error("Expected full");
    expect(result.members).toHaveLength(200);
    expect(result.banned).toHaveLength(200);
    expect(result.members[0]!.userId).toBe(actors.operator.userId);
    expect(result.memberCount).toBe(203);
  });
  it("does not disclose lounge bans if authorization changes between metadata and roster reads", async () => {
    const { spaceId } = await lounge();
    await member(spaceId, actors.operator.userId);
    await member(spaceId, actors.stranger.userId, "banned");
    const row = await memberRead.readSpaceMembers(
      actors.operator.userId,
      spaceId,
      database.db,
    );
    if (!row) throw new Error("Expected metadata");
    await database.db
      .insert(roleSettings)
      .values({ branchId: actors.branchId, role: "operator", permissions: [] });
    expect(
      await memberRead.readLoungeMembers(
        actors.operator.userId,
        row,
        database.db,
      ),
    ).toBeNull();
  });
});
