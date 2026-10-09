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
import {
  createReportActions,
  type ReportActionDependencies,
} from "@/features/admin/report-action-factory";
import { createChatActions } from "@/features/chat/action-factory";
import { createReportsQueries } from "@/features/admin/reports-query-factory";
import { createFileDownloads } from "@/features/chat/files";
import { createFileQueries } from "@/features/chat/file-query-factory";
import { createChannelActions } from "@/features/chat/channel-actions";
import { createSpaceActions } from "@/features/chat/space-action-factory";
import { createModerationActions } from "@/features/people/moderation-actions";
import type { Session } from "@/lib/auth/types";
import type { LiveKitServer } from "@/lib/calls/types";
import * as callEviction from "@/lib/calls/evict";
import * as write from "@/lib/dal/reports-write";
import * as messageWrite from "@/lib/dal/chat-message-write";
import * as attachments from "@/lib/dal/chat-attachments";
import * as callWrite from "@/lib/dal/call-write";
import { totalUploadBytes } from "@/lib/dal/chat-uploads";
import { banCommunityMember } from "@/lib/dal/chat-channel-write";
import { canReadRoom } from "@/lib/dal/chat-access";
import { createBranchLounge } from "@/lib/dal/chat-write";
import * as schema from "@/lib/db/schema";
import {
  bookings,
  branchStaff,
  callParticipants,
  callSessions,
  chatRooms,
  chatSpaceMembers,
  chatSpaces,
  messageAttachments,
  messageMentions,
  messageReactions,
  messages,
  reports,
  roleSettings,
} from "@/lib/db/schema";
import type { RealtimeItem } from "@/lib/realtime/types";
import { disabledFileStorage } from "@/lib/storage/disabled";
import {
  bookingNow,
  bookingRange,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("transactional branch report moderation", () => {
  let database: TestDatabase;
  let db: TestDatabase["db"];
  let actors: BookingActors;
  let loungeId: string;
  let roomId: string;
  let messageId: string;
  const queries: { text: string; params: unknown[] }[] = [];
  const events: RealtimeItem[] = [];
  const publishMany = vi.fn<(items: RealtimeItem[]) => Promise<void>>();
  const publish = vi.fn(async () => {});
  const remove = vi.fn<(key: string) => Promise<void>>();
  const logError = vi.fn();
  const removeParticipant = vi.fn<LiveKitServer["removeParticipant"]>();
  const livekit: LiveKitServer = {
    serverUrl: "wss://fake.invalid",
    issueToken: async () => "fake",
    verifyWebhook: async () => ({ event: "ignored" }),
    removeParticipant,
  };
  beforeAll(async () => {
    database = await createTestDatabase();
    db = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(text, params) {
          queries.push({ text, params });
        },
      },
    });
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    publishMany.mockImplementation(async (items) => {
      events.push(...items);
    });
    remove.mockResolvedValue();
    removeParticipant.mockResolvedValue();
    logError.mockImplementation(() => {});
    actors = await seedBookingActors(database);
    loungeId = (await createBranchLounge(actors.branchId, db)).spaceId;
    const [room] = await db
      .select()
      .from(chatRooms)
      .where(
        and(eq(chatRooms.spaceId, loungeId), eq(chatRooms.name, "라운지")),
      );
    roomId = room!.id;
    await db.insert(chatSpaceMembers).values(
      [actors.member, actors.person, actors.stranger].map((actor) => ({
        spaceId: loungeId,
        userId: actor.userId,
        joinedAt: new Date(bookingNow.getTime() - 60_000),
        statusChangedAt: bookingNow,
      })),
    );
    messageId = await addMessage(roomId);
    queries.length = 0;
    events.length = 0;
  });
  const deps = (
    session: Session | null = actors.operator,
  ): ReportActionDependencies => ({
    database: db,
    getSession: async () => session,
    now: () => bookingNow,
    publisher: { publish, publishMany },
    storage: { ...disabledFileStorage, remove },
    livekit: null,
    logError,
  });
  const resolve = (
    resolution: "dismissed" | "message_deleted" | "member_banned" = "dismissed",
    target = messageId,
    session: Session | null = actors.operator,
    extra: ReportActionDependencies = {},
  ) =>
    createReportActions({ ...deps(session), ...extra }).resolveReports({
      messageId: target,
      resolution,
    });
  async function addMessage(
    room: string,
    author = actors.member,
    reported = true,
  ) {
    const [cursor] = await db
      .update(chatRooms)
      .set({
        lastSeq: sql`${chatRooms.lastSeq} + 1`,
        lastMessageAt: bookingNow,
      })
      .where(eq(chatRooms.id, room))
      .returning({ seq: chatRooms.lastSeq });
    const [message] = await db
      .insert(messages)
      .values({
        roomId: room,
        authorId: author.userId,
        seq: cursor!.seq,
        body: "신고 대상 메시지",
        createdAt: bookingNow,
      })
      .returning({ id: messages.id });
    if (reported) await addReport(message!.id, actors.person, author);
    return message!.id;
  }
  async function addReport(
    target: string,
    reporter = actors.person,
    author = actors.member,
  ) {
    await db.insert(reports).values({
      reporterId: reporter.userId,
      targetUserId: author.userId,
      messageId: target,
      reason: "spam",
      detail: "가상 신고 설명",
      createdAt: bookingNow,
    });
  }
  const savedMessage = async (target = messageId) =>
    (await db.select().from(messages).where(eq(messages.id, target)))[0]!;
  const savedReports = (target = messageId) =>
    db.select().from(reports).where(eq(reports.messageId, target));
  const member = async () =>
    (
      await db
        .select()
        .from(chatSpaceMembers)
        .where(
          and(
            eq(chatSpaceMembers.spaceId, loungeId),
            eq(chatSpaceMembers.userId, actors.member.userId),
          ),
        )
    )[0];
  async function attach(target = messageId, room = roomId, count = 1) {
    const rows = Array.from({ length: count }, (_, position) => ({
      id: crypto.randomUUID(),
      roomId: room,
      uploaderId: actors.member.userId,
      messageId: target,
      position,
      storageKey: `fake/${crypto.randomUUID()}`,
      name: `자료${position}.txt`,
      size: 12,
      contentType: "text/plain",
      kind: "file" as const,
      uploadedAt: bookingNow,
    }));
    await db.insert(messageAttachments).values(rows);
    return rows;
  }
  async function meeting(otherBranch = false) {
    const [booking] = await db
      .insert(bookings)
      .values({
        userId: actors.member.userId,
        spaceId: otherBranch ? actors.otherSpaceId : actors.publicSpaceId,
        during: bookingRange(),
        title: "가상 회의",
      })
      .returning();
    const [room] = await db
      .insert(chatRooms)
      .values({ kind: "meeting", bookingId: booking!.id })
      .returning();
    return {
      roomId: room!.id,
      messageId: await addMessage(room!.id),
      bookingId: booking!.id,
    };
  }
  async function voiceCall(room?: string) {
    const voice =
      room ??
      (
        await db
          .select()
          .from(chatRooms)
          .where(
            and(eq(chatRooms.spaceId, loungeId), eq(chatRooms.kind, "voice")),
          )
      )[0]!.id;
    const [call] = await db
      .insert(callSessions)
      .values({
        roomId: voice,
        kind: "voice",
        startedBy: actors.member.userId,
        startedAt: bookingNow,
      })
      .returning();
    const [participant] = await db
      .insert(callParticipants)
      .values({
        sessionId: call!.id,
        userId: actors.member.userId,
        joinedAt: bookingNow,
        lastSeenAt: bookingNow,
      })
      .returning();
    return { roomId: voice, participant: participant!, session: call! };
  }
  async function disablePermission(
    tx: Parameters<typeof write.lockReportSpace>[1] = db,
  ) {
    await tx.insert(roleSettings).values({
      branchId: actors.branchId,
      role: "operator",
      permissions: [],
      updatedAt: bookingNow,
    });
  }

  it("checks session before schema or any SQL", async () => {
    const result = await createReportActions(deps(null)).resolveReports({
      messageId: "bad",
    });
    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(queries).toEqual([]);
  });
  it.each([
    null,
    {},
    { resolution: "dismissed" },
    { messageId: "bad", resolution: "dismissed" },
    { resolution: "unknown" },
    { branchId: "ignored" },
    { operatorId: "untrusted" },
  ])("rejects malformed or extra input %j before SQL", async (override) => {
    const input =
      override === null
        ? null
        : { messageId, resolution: "dismissed", ...override };
    if (override && Object.keys(override).length === 0) {
      expect((await createReportActions(deps()).resolveReports({})).ok).toBe(
        false,
      );
    } else if (
      override &&
      Object.keys(override).length === 1 &&
      "resolution" in override &&
      override.resolution === "dismissed"
    ) {
      expect(
        (await createReportActions(deps()).resolveReports(override)).ok,
      ).toBe(false);
    } else
      expect(
        await createReportActions(deps()).resolveReports(input),
      ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(queries).toEqual([]);
  });
  it("normalizes UUID input and returns only the message identifier", async () => {
    expect(
      await createReportActions(deps()).resolveReports({
        messageId: messageId.toUpperCase(),
        resolution: "dismissed",
      }),
    ).toEqual({ ok: true, data: { messageId } });
  });
  it("dismisses all open reports atomically without deleting content or publishing", async () => {
    await addReport(messageId, actors.stranger);
    const before = await savedMessage();
    expect(await resolve()).toEqual({ ok: true, data: { messageId } });
    const saved = await savedReports();
    expect(saved).toHaveLength(2);
    for (const row of saved)
      expect(row).toMatchObject({
        resolvedAt: bookingNow,
        resolvedBy: actors.operator.userId,
        resolution: "dismissed",
      });
    expect(await savedMessage()).toEqual(before);
    expect(events).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
  });
  it("deletes through the shared core including reactions, mentions and attachments", async () => {
    await db
      .update(messages)
      .set({ mentionsEveryone: true })
      .where(eq(messages.id, messageId));
    await db
      .insert(messageMentions)
      .values({ messageId, userId: actors.person.userId });
    await db
      .insert(messageReactions)
      .values({ messageId, userId: actors.person.userId, emoji: "heart" });
    const files = await attach(messageId, roomId, 2);
    remove.mockImplementation(async () => {
      expect((await savedReports())[0]!.resolution).toBe("message_deleted");
      expect(await db.select().from(messageAttachments)).toEqual([]);
    });
    expect(await resolve("message_deleted")).toEqual({
      ok: true,
      data: { messageId },
    });
    expect(await savedMessage()).toMatchObject({
      body: "",
      deletedAt: bookingNow,
      deletedBy: actors.operator.userId,
      mentionsEveryone: false,
      seq: 1,
    });
    expect(await db.select().from(messageMentions)).toEqual([]);
    expect(await db.select().from(messageReactions)).toEqual([]);
    expect(remove.mock.calls.map(([key]) => key).sort()).toEqual(
      files.map((file) => file.storageKey).sort(),
    );
    expect(events).toEqual([
      {
        channel: `room:${roomId}`,
        event: { type: "message.deleted", roomId, id: messageId, seq: 1 },
      },
    ]);
  });
  it("does not require the operator to join the lounge", async () => {
    expect(await canReadRoom(actors.operator.userId, roomId, db)).toBeNull();
    expect((await resolve("message_deleted")).ok).toBe(true);
    expect(
      await db
        .select()
        .from(chatSpaceMembers)
        .where(eq(chatSpaceMembers.userId, actors.operator.userId)),
    ).toEqual([]);
  });
  it("deletes a reported meeting message without meeting membership or changing the booking", async () => {
    const target = await meeting();
    const before = await db.select().from(bookings);
    expect(
      await canReadRoom(actors.operator.userId, target.roomId, db),
    ).toBeNull();
    expect(
      await createChatActions(deps()).deleteMessage({
        messageId: target.messageId,
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect((await resolve("message_deleted", target.messageId)).ok).toBe(true);
    expect((await savedMessage(target.messageId)).deletedBy).toBe(
      actors.operator.userId,
    );
    expect(await db.select().from(bookings)).toEqual(before);
  });
  it("keeps the original deletion attribution and does not publish a second deletion", async () => {
    const previous = new Date(bookingNow.getTime() - 10_000);
    await db
      .update(messages)
      .set({ body: "", deletedAt: previous, deletedBy: actors.member.userId })
      .where(eq(messages.id, messageId));
    expect((await resolve("message_deleted")).ok).toBe(true);
    expect(await savedMessage()).toMatchObject({
      deletedAt: previous,
      deletedBy: actors.member.userId,
    });
    expect((await savedReports())[0]!.resolution).toBe("message_deleted");
    expect(events).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
  });
  it.each(["dismissed", "message_deleted", "member_banned"] as const)(
    "rejects a second %s resolution with no further side effects",
    async (resolution) => {
      expect((await resolve(resolution)).ok).toBe(true);
      const before = await savedMessage();
      const previousEvents = events.slice();
      expect(await resolve(resolution)).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
      expect(await savedMessage()).toEqual(before);
      expect(events).toEqual(previousEvents);
    },
  );
  it("rejects an unreported message without modifying it", async () => {
    const target = await addMessage(roomId, actors.member, false);
    expect(await resolve("message_deleted", target)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect((await savedMessage(target)).deletedAt).toBeNull();
  });
  it.each(["member", "otherOperator"] as const)(
    "hides reports from %s outside the branch staff scope",
    async (actor) => {
      expect(
        await resolve("message_deleted", messageId, actors[actor]),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
      expect((await savedReports())[0]!.resolvedAt).toBeNull();
    },
  );
  it("hides another branch's meeting and lounge", async () => {
    const other = await meeting(true);
    expect(await resolve("message_deleted", other.messageId)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    const otherLounge = await createBranchLounge(actors.otherBranchId, db);
    const [otherRoom] = await db
      .select()
      .from(chatRooms)
      .where(
        and(
          eq(chatRooms.spaceId, otherLounge.spaceId),
          eq(chatRooms.kind, "text"),
        ),
      );
    const target = await addMessage(otherRoom!.id);
    expect(await resolve("message_deleted", target)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });
  it.each(["dm", "group_dm", "team", "community"] as const)(
    "does not moderate %s messages",
    async (kind) => {
      let targetRoom: string;
      if (kind === "dm" || kind === "group_dm") {
        const pair = [actors.member.userId, actors.person.userId].sort();
        const [room] = await db
          .insert(chatRooms)
          .values(
            kind === "dm"
              ? { kind, dmLowUserId: pair[0]!, dmHighUserId: pair[1]! }
              : { kind, name: "가상 그룹" },
          )
          .returning();
        targetRoom = room!.id;
      } else {
        const [space] = await db
          .insert(chatSpaces)
          .values(
            kind === "team"
              ? { kind, teamId: actors.teamId }
              : {
                  kind,
                  name: "가상 커뮤니티",
                  createdBy: actors.member.userId,
                },
          )
          .returning();
        const [room] = await db
          .insert(chatRooms)
          .values({ kind: "text", spaceId: space!.id, name: "일반" })
          .returning();
        targetRoom = room!.id;
      }
      const target = await addMessage(targetRoom);
      expect(await resolve("message_deleted", target)).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
      expect((await savedMessage(target)).deletedAt).toBeNull();
    },
  );
  it("never treats a user-only report as an open message report", async () => {
    await db.delete(reports);
    await db.insert(reports).values({
      reporterId: actors.person.userId,
      targetUserId: actors.member.userId,
      reason: "spam",
      createdAt: bookingNow,
    });
    expect(await resolve()).toEqual({ ok: false, code: "NOT_FOUND" });
    expect((await db.select().from(reports))[0]!.resolvedAt).toBeNull();
  });
  it("rejects missing and system message identifiers", async () => {
    expect(await resolve("dismissed", crypto.randomUUID())).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    await db
      .update(messages)
      .set({
        kind: "system",
        authorId: null,
        systemData: { type: "group_created", actorName: "가상" },
      })
      .where(eq(messages.id, messageId));
    expect(await resolve()).toEqual({ ok: false, code: "NOT_FOUND" });
  });
  it("does not silently exclude archived channels from moderation scope", async () => {
    await db
      .update(chatRooms)
      .set({ archivedAt: bookingNow })
      .where(eq(chatRooms.id, roomId));
    expect((await resolve("message_deleted")).ok).toBe(true);
  });
  it("rejects disabled permission without changing reports", async () => {
    await disablePermission();
    expect(await resolve("message_deleted")).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect((await savedReports())[0]!.resolvedAt).toBeNull();
  });
  it("rechecks permission after acquiring the space lock", async () => {
    const original = write.lockReportSpace;
    vi.spyOn(write, "lockReportSpace").mockImplementationOnce(
      async (input, tx) => {
        const locked = await original(input, tx);
        await disablePermission(tx);
        return locked;
      },
    );
    expect(await resolve("message_deleted")).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect((await savedMessage()).deletedAt).toBeNull();
  });
  it("rechecks staff membership after acquiring the space lock", async () => {
    const original = write.lockReportSpace;
    vi.spyOn(write, "lockReportSpace").mockImplementationOnce(
      async (input, tx) => {
        const locked = await original(input, tx);
        await tx
          .delete(branchStaff)
          .where(eq(branchStaff.userId, actors.operator.userId));
        return locked;
      },
    );
    expect(await resolve("message_deleted")).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
  });
  it("rejects a meeting ban and rolls back all message/report changes", async () => {
    const target = await meeting();
    expect(await resolve("member_banned", target.messageId)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect((await savedMessage(target.messageId)).deletedAt).toBeNull();
    expect((await savedReports(target.messageId))[0]!.resolvedAt).toBeNull();
  });
  it("bans an active lounge author and emits deletion, space and user events once", async () => {
    expect((await resolve("member_banned")).ok).toBe(true);
    expect(await member()).toMatchObject({
      status: "banned",
      role: "member",
      statusChangedAt: bookingNow,
    });
    expect(events.map(({ event }) => event.type).sort()).toEqual([
      "message.deleted",
      "realtime.reauth",
      "space.changed",
    ]);
    expect(events).toContainEqual({
      channel: `user:${actors.member.userId}`,
      event: { type: "realtime.reauth" },
    });
    expect(
      queries.some(({ text }) =>
        /update "chat_space_invites"|delete from "notifications"/.test(text),
      ),
    ).toBe(false);
  });
  it("inserts a banned row for an author who already left", async () => {
    await db
      .delete(chatSpaceMembers)
      .where(eq(chatSpaceMembers.userId, actors.member.userId));
    expect((await resolve("member_banned")).ok).toBe(true);
    expect(await member()).toMatchObject({
      status: "banned",
      role: "member",
      joinedAt: bookingNow,
    });
    expect(
      await createSpaceActions(deps(actors.member)).joinLounge({
        branchId: actors.branchId,
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
  });
  it("keeps an existing ban unchanged while resolving another reported message", async () => {
    const other = await addMessage(roomId);
    expect((await resolve("member_banned")).ok).toBe(true);
    const previous = await member();
    events.length = 0;
    const evict = vi.spyOn(callEviction, "evictCalls");
    expect((await resolve("member_banned", other)).ok).toBe(true);
    expect(await member()).toEqual(previous);
    expect(events).toEqual([
      {
        channel: `room:${roomId}`,
        event: { type: "message.deleted", roomId, id: other, seq: 2 },
      },
    ]);
    expect(evict).not.toHaveBeenCalled();
    expect((await savedReports(other))[0]!.resolution).toBe("member_banned");
  });
  it("does not allow self-ban", async () => {
    const target = await addMessage(roomId, actors.operator);
    expect(await resolve("member_banned", target)).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
  });
  it.each([true, false])(
    "protects a lounge administrator even with membership=%s",
    async (present) => {
      await db
        .insert(branchStaff)
        .values({ branchId: actors.branchId, userId: actors.member.userId });
      if (!present)
        await db
          .delete(chatSpaceMembers)
          .where(eq(chatSpaceMembers.userId, actors.member.userId));
      expect(await resolve("member_banned")).toEqual({
        ok: false,
        code: "INVALID_INPUT",
      });
      expect((await savedMessage()).deletedAt).toBeNull();
    },
  );
  it("protects an ordinary user granted branch.announce through user permissions", async () => {
    await db.insert(roleSettings).values({
      branchId: actors.branchId,
      role: "user",
      permissions: ["branch.announce"],
      updatedAt: bookingNow,
    });
    expect(await resolve("member_banned")).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
  });
  it("does not mistake staff of another branch for this lounge's administrator", async () => {
    await db
      .insert(branchStaff)
      .values({ branchId: actors.otherBranchId, userId: actors.member.userId });
    expect((await resolve("member_banned")).ok).toBe(true);
    expect(await member()).toMatchObject({ status: "banned" });
  });
  it("rechecks author administrator status after the lock", async () => {
    const original = write.lockReportSpace;
    vi.spyOn(write, "lockReportSpace").mockImplementationOnce(
      async (input, tx) => {
        const locked = await original(input, tx);
        await tx
          .insert(branchStaff)
          .values({ branchId: actors.branchId, userId: actors.member.userId });
        return locked;
      },
    );
    expect(await resolve("member_banned")).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
  });
  it("validates the actual space kind before branch-mode missing-member insertion", async () => {
    const [space] = await db
      .insert(chatSpaces)
      .values({
        kind: "community",
        name: "가상",
        createdBy: actors.person.userId,
      })
      .returning();
    await expect(
      db.transaction((tx) =>
        banCommunityMember(space!.id, actors.member.userId, bookingNow, tx, {
          kind: "branch",
        }),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(
      await db
        .select()
        .from(chatSpaceMembers)
        .where(eq(chatSpaceMembers.spaceId, space!.id)),
    ).toEqual([]);
  });
  it.each(["dismissed", "member_banned"] as const)(
    "locks UUID-ordered users then space/member/room/message/reports for %s",
    async (resolution) => {
      expect((await resolve(resolution)).ok).toBe(true);
      const locks = queries.filter(({ text }) =>
        /for (update|key share)/i.test(text),
      );
      expect(
        locks.map(({ text }) => text.match(/from "([a-z_]+)"/)?.[1]),
      ).toEqual([
        "users",
        "chat_spaces",
        "chat_space_members",
        "chat_rooms",
        "messages",
        "reports",
      ]);
      expect(locks[0]!.text).toMatch(
        /order by "users"\."id" asc for key share/i,
      );
      expect(locks[0]!.params).toEqual(
        [actors.operator.userId, actors.member.userId].sort(),
      );
      expect(locks[1]!.text).toContain(
        resolution === "member_banned" ? "for update" : "for key share",
      );
      expect(locks[5]!.text).toMatch(
        /resolved_at" is null.*order by.*for update/,
      );
      const update = queries.find(({ text }) =>
        text.startsWith('update "reports"'),
      )!;
      expect(update.text).toMatch(/resolved_at" is null.*returning/);
    },
  );
  it("keeps the meeting lock path free of lounge/member and booking locks", async () => {
    const target = await meeting();
    queries.length = 0;
    expect((await resolve("message_deleted", target.messageId)).ok).toBe(true);
    expect(
      queries
        .filter(({ text }) => /for (update|key share)/i.test(text))
        .map(({ text }) => text.match(/from "([a-z_]+)"/)?.[1]),
    ).toEqual(["users", "chat_rooms", "messages", "reports"]);
  });
  it("rolls back a late report update failure including deleted body, attachments and ban", async () => {
    const files = await attach();
    const original = write.resolveMessageReports;
    vi.spyOn(write, "resolveMessageReports").mockImplementationOnce(
      async (input, tx) => {
        await original(input, tx);
        throw new Error("simulated database failure");
      },
    );
    expect(await resolve("member_banned")).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect((await savedMessage()).deletedAt).toBeNull();
    expect(await member()).toMatchObject({ status: "active" });
    expect((await savedReports())[0]!.resolvedAt).toBeNull();
    expect(
      (await db.select().from(messageAttachments)).map(({ id }) => id),
    ).toEqual(files.map(({ id }) => id));
    expect(events).toEqual([]);
    expect(remove).not.toHaveBeenCalled();
    expect(removeParticipant).not.toHaveBeenCalled();
  });
  it("rolls back a conditional resolution mismatch", async () => {
    vi.spyOn(write, "resolveMessageReports").mockResolvedValueOnce([]);
    expect(await resolve("message_deleted")).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect((await savedMessage()).deletedAt).toBeNull();
  });
  it("rolls back deletion if attachment removal fails inside the transaction", async () => {
    await attach();
    vi.spyOn(attachments, "deleteMessageAttachments").mockRejectedValueOnce(
      new Error("simulated"),
    );
    expect(await resolve("message_deleted")).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect((await savedMessage()).deletedAt).toBeNull();
    expect((await savedReports())[0]!.resolvedAt).toBeNull();
    expect(remove).not.toHaveBeenCalled();
  });
  it("does not repeat processing after an initial target read loses to another moderator", async () => {
    const original = write.readReportTarget;
    vi.spyOn(write, "readReportTarget").mockImplementationOnce(
      async (...args) => {
        const target = await original(...args);
        expect((await resolve("message_deleted")).ok).toBe(true);
        return target;
      },
    );
    expect(await resolve("member_banned")).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(
      events.filter(({ event }) => event.type === "message.deleted"),
    ).toHaveLength(1);
    expect(await member()).toMatchObject({ status: "active" });
  });
  it("a reporter waiting behind deletion rechecks the locked message before inserting", async () => {
    const original = messageWrite.findMessageTarget;
    vi.spyOn(messageWrite, "findMessageTarget").mockImplementationOnce(
      async (...args) => {
        const target = await original(...args);
        expect((await resolve("message_deleted")).ok).toBe(true);
        return target;
      },
    );
    expect(
      await createModerationActions(deps(actors.stranger)).reportMessage({
        messageId,
        reason: "harassment",
      }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await savedReports()).toHaveLength(1);
  });
  it("preserves the first resolution when a fresh reporter later reports the dismissed live message", async () => {
    expect((await resolve()).ok).toBe(true);
    expect(
      await createModerationActions(deps(actors.stranger)).reportMessage({
        messageId,
        reason: "harassment",
      }),
    ).toEqual({ ok: true, data: {} });
    const later = new Date(bookingNow.getTime() + 1000);
    expect(
      (
        await resolve("message_deleted", messageId, actors.operator, {
          now: () => later,
        })
      ).ok,
    ).toBe(true);
    const rows = await savedReports();
    expect(
      rows.find((row) => row.reporterId === actors.person.userId),
    ).toMatchObject({ resolution: "dismissed", resolvedAt: bookingNow });
    expect(
      rows.find((row) => row.reporterId === actors.stranger.userId),
    ).toMatchObject({ resolution: "message_deleted", resolvedAt: later });
  });
  it("finishes all post-commit categories even when publication, one file and logger fail", async () => {
    const files = await attach(messageId, roomId, 2);
    publishMany.mockImplementation(async (items) => {
      events.push(...items);
      if (items[0]!.event.type === "message.deleted")
        throw new Error("publisher failed");
    });
    remove.mockRejectedValueOnce(new Error("storage failed"));
    logError.mockImplementation(() => {
      throw new Error("logger failed");
    });
    const evict = vi
      .spyOn(callEviction, "evictCalls")
      .mockRejectedValueOnce(new Error("call cleanup failed"));
    expect((await resolve("member_banned")).ok).toBe(true);
    expect((await savedReports())[0]!.resolution).toBe("member_banned");
    expect(events.map(({ event }) => event.type).sort()).toEqual([
      "message.deleted",
      "realtime.reauth",
      "space.changed",
    ]);
    expect(remove.mock.calls.map(([key]) => key).sort()).toEqual(
      files.map((file) => file.storageKey).sort(),
    );
    expect(evict).toHaveBeenCalledExactlyOnceWith(
      actors.member.userId,
      expect.objectContaining({ database: db }),
    );
  });
  it("evicts only the banned author's lounge call after report transaction commit", async () => {
    const call = await voiceCall();
    removeParticipant.mockImplementation(async () => {
      expect((await savedReports())[0]!.resolution).toBe("member_banned");
      expect(await member()).toMatchObject({ status: "banned" });
    });
    expect(
      (await resolve("member_banned", messageId, actors.operator, { livekit }))
        .ok,
    ).toBe(true);
    expect(removeParticipant).toHaveBeenCalledExactlyOnceWith(
      `call:${call.roomId}`,
      call.participant.id,
    );
    expect((await db.select().from(callParticipants))[0]!.leftAt).toEqual(
      bookingNow,
    );
    expect((await db.select().from(callSessions))[0]!.endedAt).toEqual(
      bookingNow,
    );
    expect(events.some(({ event }) => event.type === "call.changed")).toBe(
      true,
    );
  });
  it("does not evict the author's still-authorized call in another lounge", async () => {
    const other = await createBranchLounge(actors.otherBranchId, db);
    await db.insert(chatSpaceMembers).values({
      spaceId: other.spaceId,
      userId: actors.member.userId,
      joinedAt: bookingNow,
      statusChangedAt: bookingNow,
    });
    const [voice] = await db
      .select()
      .from(chatRooms)
      .where(
        and(eq(chatRooms.spaceId, other.spaceId), eq(chatRooms.kind, "voice")),
      );
    const call = await voiceCall(voice!.id);
    expect(
      (await resolve("member_banned", messageId, actors.operator, { livekit }))
        .ok,
    ).toBe(true);
    expect(removeParticipant).not.toHaveBeenCalled();
    expect(
      (
        await db
          .select()
          .from(callParticipants)
          .where(eq(callParticipants.id, call.participant.id))
      )[0]!.leftAt,
    ).toBeNull();
  });
  it("keeps moderation committed when the media provider rejects eviction", async () => {
    await voiceCall();
    removeParticipant.mockRejectedValueOnce(new Error("provider failed"));
    expect(
      (await resolve("member_banned", messageId, actors.operator, { livekit }))
        .ok,
    ).toBe(true);
    expect((await savedReports())[0]!.resolution).toBe("member_banned");
    expect(logError).toHaveBeenCalledWith("Call participant removal failed.");
    expect(events.some(({ event }) => event.type === "call.changed")).toBe(
      true,
    );
  });
  it("allows lounge administrators to unban without automatically rejoining the target", async () => {
    await resolve("member_banned");
    await db.insert(chatSpaceMembers).values({
      spaceId: loungeId,
      userId: actors.operator.userId,
      joinedAt: bookingNow,
      statusChangedAt: bookingNow,
    });
    events.length = 0;
    expect(
      await createChannelActions(deps()).unbanSpaceMember({
        spaceId: loungeId,
        userId: actors.member.userId,
      }),
    ).toEqual({ ok: true, data: {} });
    expect(await member()).toBeUndefined();
    expect(events).toEqual([
      {
        channel: `space:${loungeId}`,
        event: { type: "space.changed", spaceId: loungeId },
      },
    ]);
    expect(
      (
        await createSpaceActions(deps(actors.member)).joinLounge({
          branchId: actors.branchId,
        })
      ).ok,
    ).toBe(true);
  });
  it("keeps ordinary lounge members and disabled administrators from unbanning", async () => {
    await resolve("member_banned");
    expect(
      await createChannelActions(deps(actors.person)).unbanSpaceMember({
        spaceId: loungeId,
        userId: actors.member.userId,
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    await db.insert(chatSpaceMembers).values({
      spaceId: loungeId,
      userId: actors.operator.userId,
      joinedAt: bookingNow,
      statusChangedAt: bookingNow,
    });
    await disablePermission();
    expect(
      await createChannelActions(deps()).unbanSpaceMember({
        spaceId: loungeId,
        userId: actors.member.userId,
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await member()).toMatchObject({ status: "banned" });
  });
  it("does not open the generic public ban action for lounge administrators", async () => {
    await db.insert(chatSpaceMembers).values({
      spaceId: loungeId,
      userId: actors.operator.userId,
      joinedAt: bookingNow,
      statusChangedAt: bookingNow,
    });
    expect(
      await createChannelActions(deps()).banSpaceMember({
        spaceId: loungeId,
        userId: actors.member.userId,
      }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await member()).toMatchObject({ status: "active" });
  });
  it("keeps branch unban successful when both realtime publication and logging throw", async () => {
    await resolve("member_banned");
    await db.insert(chatSpaceMembers).values({
      spaceId: loungeId,
      userId: actors.operator.userId,
      joinedAt: bookingNow,
      statusChangedAt: bookingNow,
    });
    publishMany.mockRejectedValueOnce(new Error("publication failed"));
    logError.mockImplementation(() => {
      throw new Error("logger failed");
    });
    expect(
      await createChannelActions(deps()).unbanSpaceMember({
        spaceId: loungeId,
        userId: actors.member.userId,
      }),
    ).toEqual({ ok: true, data: {} });
    expect(await member()).toBeUndefined();
    expect(logError).toHaveBeenCalledWith("Space realtime publication failed.");
  });
  it("runs reporting, scoped admin listing and deletion as one real application flow", async () => {
    await db.delete(reports);
    expect(
      await createModerationActions(deps(actors.person)).reportMessage({
        messageId,
        reason: "spam",
        detail: "같은 광고가 반복돼요",
      }),
    ).toEqual({ ok: true, data: {} });
    const query = createReportsQueries({
      database: db,
      requireSession: async () => actors.operator,
      now: () => bookingNow,
    });
    const before = await query.getBranchReports({
      branchId: actors.branchId,
      tab: "open",
    });
    expect(before.rows).toHaveLength(1);
    expect(before.rows[0]).toMatchObject({
      messageId,
      count: 1,
      body: "신고 대상 메시지",
      deleted: false,
    });
    expect((await resolve("message_deleted")).ok).toBe(true);
    expect(
      (await query.getBranchReports({ branchId: actors.branchId, tab: "open" }))
        .rows,
    ).toEqual([]);
    const after = await query.getBranchReports({
      branchId: actors.branchId,
      tab: "resolved",
    });
    expect(after.rows[0]).toMatchObject({
      messageId,
      resolution: "message_deleted",
      deleted: true,
      resolvedByName: actors.operator.name,
    });
    expect(events).toContainEqual({
      channel: `room:${roomId}`,
      event: { type: "message.deleted", roomId, id: messageId, seq: 1 },
    });
  });
  it("removes file listing, download authorization and quota even if physical cleanup fails", async () => {
    const [file] = await attach();
    const cutoff = new Date(bookingNow.getTime() - 86_400_000);
    expect(await totalUploadBytes(actors.member.userId, cutoff, db)).toBe(12);
    const fileQueries = createFileQueries({
      database: db,
      requireSession: async () => actors.member,
      now: () => bookingNow,
    });
    expect(
      (await fileQueries.getRoomFiles(roomId, {})).files.map(({ id }) => id),
    ).toEqual([file!.id]);
    remove.mockRejectedValueOnce(new Error("physical cleanup unavailable"));
    expect((await resolve("message_deleted")).ok).toBe(true);
    expect(await totalUploadBytes(actors.member.userId, cutoff, db)).toBe(0);
    expect((await fileQueries.getRoomFiles(roomId, {})).files).toEqual([]);
    const stat = vi.fn(async () => ({ size: 12 }));
    const response = await createFileDownloads({
      database: db,
      requireSession: async () => actors.member,
      now: () => bookingNow,
      storage: { ...disabledFileStorage, kind: "local", stat },
    }).getFile(new Request(`http://localhost/api/files/${file!.id}`), file!.id);
    expect(response.status).toBe(404);
    expect(stat).not.toHaveBeenCalled();
  });
  it("preserves attached files and quota when dismissing reports", async () => {
    const files = await attach();
    expect((await resolve()).ok).toBe(true);
    expect(
      (await db.select().from(messageAttachments)).map(({ id }) => id),
    ).toEqual(files.map(({ id }) => id));
    expect(remove).not.toHaveBeenCalled();
  });
  it("preserves moderation when the separate call eviction transaction rolls back", async () => {
    const call = await voiceCall();
    const original = callWrite.closeCallParticipant;
    vi.spyOn(callWrite, "closeCallParticipant").mockImplementationOnce(
      async (...args) => {
        await original(...args);
        throw new Error("call transaction failed");
      },
    );
    expect(
      (await resolve("member_banned", messageId, actors.operator, { livekit }))
        .ok,
    ).toBe(true);
    expect((await savedReports())[0]!.resolution).toBe("member_banned");
    expect(await member()).toMatchObject({ status: "banned" });
    expect(
      (
        await db
          .select()
          .from(callParticipants)
          .where(eq(callParticipants.id, call.participant.id))
      )[0]!.leftAt,
    ).toBeNull();
    expect(removeParticipant).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith("Call eviction failed.");
  });
});
