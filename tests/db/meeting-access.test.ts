import { and, eq } from "drizzle-orm";
import type { TokenParams, TokenRequest } from "ably";
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
import { createChatActions } from "@/features/chat/action-factory";
import { createChatQueries } from "@/features/chat/query-factory";
import { createRealtimeToken } from "@/features/chat/realtime-token";
import type { Session } from "@/lib/auth/types";
import { canReadRoom, canWriteRoom } from "@/lib/dal/chat-access";
import { createMeetingRoom } from "@/lib/dal/chat-meeting";
import * as writes from "@/lib/dal/chat-write";
import * as schema from "@/lib/db/schema";
import {
  bookings,
  bookingParticipants,
  chatRoomReads,
  messages,
  messageMentions,
} from "@/lib/db/schema";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import type { RealtimeItem } from "@/lib/realtime/types";
import { createTestDatabase, type TestDatabase } from "./helper";
import {
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";

describe("booking-owned meeting access and message mutations", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  let booking: typeof bookings.$inferSelect;
  let roomId: string;
  const now = new Date(bookingNow.getTime() + 60_000);
  const events: RealtimeItem[] = [];
  const queries: string[] = [];
  const publisher = {
    publish: vi.fn(),
    publishMany: vi.fn(async (items: readonly RealtimeItem[]) => {
      events.push(...items);
    }),
  };
  beforeAll(async () => {
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema,
      logger: { logQuery: (text) => queries.push(text) },
    });
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    actors = await seedBookingActors(database);
    booking = await insertFixtureBooking(database, actors, {
      during: bookingRange("13:00", "14:00"),
      spaceId: actors.restrictedSpaceId,
      teamId: actors.teamId,
    });
    await database.db.insert(bookingParticipants).values({
      bookingId: booking.id,
      userId: actors.stranger.userId,
      createdAt: bookingNow,
    });
    roomId = (
      await createMeetingRoom(
        { bookingId: booking.id, now: bookingNow },
        database.db,
      )
    ).id;
    await writes.insertSystemMessage(
      {
        roomId,
        actorId: actors.person.userId,
        now: bookingNow,
        data: { type: "booking_created", actorName: actors.person.name },
      },
      database.db,
    );
    events.length = 0;
    queries.length = 0;
  });
  const actions = (session = actors.person, instant = now) =>
    createChatActions({
      database: database.db,
      getSession: async () => session,
      now: () => instant,
      publisher,
      limiter: createMemoryRateLimiter(() => instant.getTime()),
      logError: vi.fn(),
    });
  const read = (session = actors.person, instant = now) =>
    createChatQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => instant,
      limiter: createMemoryRateLimiter(() => instant.getTime()),
    });
  async function send(
    body = "회의를 준비해요",
    session = actors.person,
    instant = now,
  ) {
    const result = await actions(session, instant).sendMessage({
      roomId,
      body,
      clientId: crypto.randomUUID(),
    });
    if (!result.ok) throw new Error(`Send failed ${result.code}`);
    return result.data;
  }
  async function removeGuest() {
    await database.db
      .delete(bookingParticipants)
      .where(
        and(
          eq(bookingParticipants.bookingId, booking.id),
          eq(bookingParticipants.userId, actors.stranger.userId),
        ),
      );
  }
  async function cancel() {
    await database.db
      .update(bookings)
      .set({
        status: "cancelled",
        cancelledAt: now,
        cancelledBy: actors.person.userId,
      })
      .where(eq(bookings.id, booking.id));
  }

  it("reads only as the booker or a current participant regardless of team, staff, or space access", async () => {
    for (const session of [actors.person, actors.stranger]) {
      expect(
        await canReadRoom(session.userId, roomId, database.db),
      ).toMatchObject({ kind: "meeting", booking: { id: booking.id } });
      expect((await read(session).getMeetingView(booking.id))?.canWrite).toBe(
        true,
      );
    }
    for (const session of [
      actors.member,
      actors.admin,
      actors.operator,
      actors.otherOperator,
    ]) {
      expect(await canReadRoom(session.userId, roomId, database.db)).toBeNull();
      expect(await read(session).getMeetingView(booking.id)).toBeNull();
      expect(
        await actions(session).sendMessage({
          roomId,
          body: "안녕",
          clientId: crypto.randomUUID(),
        }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
    }
    await removeGuest();
    expect(
      await canReadRoom(actors.stranger.userId, roomId, database.db),
    ).toBeNull();
    await expect(
      read(actors.stranger).getRoomMessagesPage(roomId, { after: "0" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it.each([23, 24, 25])(
    "binds the same instant before and after locks at end + %s hours",
    async (hours) => {
      const instant = new Date(
        booking.during.end.getTime() + hours * 3_600_000,
      );
      expect(
        await canWriteRoom(actors.person.userId, roomId, database.db, instant),
      ).toMatchObject({
        canWrite: hours < 24,
        readOnlyReason: hours < 24 ? null : "ended",
      });
      const original = await send();
      const update = await actions(actors.person, instant).editMessage({
        messageId: original.id,
        body: "수정했어요",
      });
      const reaction = await actions(actors.stranger, instant).setReaction({
        messageId: original.id,
        emoji: "heart",
        on: true,
      });
      const created = await actions(actors.person, instant).sendMessage({
        roomId,
        body: "경계 확인",
        clientId: crypto.randomUUID(),
      });
      for (const result of [update, reaction, created])
        expect(result.ok).toBe(hours < 24);
      if (hours >= 24)
        for (const result of [update, reaction, created])
          expect(result).toEqual({ ok: false, code: "FORBIDDEN" });
    },
  );
  it("gives cancellation priority over expiration and still allows only own text deletion", async () => {
    const mine = await send();
    const other = await send("참석자 글", actors.stranger);
    await cancel();
    const instant = new Date(booking.during.end.getTime() + 25 * 3_600_000);
    expect(
      await canWriteRoom(actors.person.userId, roomId, database.db, instant),
    ).toMatchObject({ canWrite: false, readOnlyReason: "cancelled" });
    expect(
      await actions(actors.person, instant).deleteMessage({
        messageId: other.id,
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await actions(actors.admin, instant).deleteMessage({
        messageId: mine.id,
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await actions(actors.person, instant).deleteMessage({
        messageId: mine.id,
      }),
    ).toMatchObject({ ok: true });
    const system = (await read().getRoomMessagesPage(roomId, { after: "0" }))
      .messages[0]!;
    expect(await actions().deleteMessage({ messageId: system.id })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    expect(
      await read(actors.stranger, instant).getMeetingView(booking.id),
    ).toMatchObject({
      canWrite: false,
      readOnlyReason: "cancelled",
      canEditBooking: false,
    });
  });
  it("rechecks removed membership after the final room lock without locking a booking afterward", async () => {
    const originalLock = writes.lockRoomForMessage;
    vi.spyOn(writes, "lockRoomForMessage").mockImplementationOnce(
      async (id, tx) => {
        await tx
          .delete(bookingParticipants)
          .where(eq(bookingParticipants.bookingId, booking.id));
        return originalLock(id, tx);
      },
    );
    expect(
      await actions(actors.stranger).sendMessage({
        roomId,
        body: "늦은 전송",
        clientId: crypto.randomUUID(),
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await database.db.select().from(messages)).toHaveLength(1);
    expect(publisher.publishMany).not.toHaveBeenCalled();
    const locks = queries.filter((text) =>
      /for (update|key share)/i.test(text),
    );
    expect(locks[0]).toContain('from "users"');
    expect(locks[1]).toContain('from "chat_rooms"');
    expect(locks).toHaveLength(2);
    expect(
      queries.some(
        (text) =>
          text.includes('from "bookings"') && text.includes("for update"),
      ),
    ).toBe(false);
  });
  it("allows every member to mention everyone, sends private user activity, and never includes outsiders", async () => {
    const message = await send(
      `<@everyone> <@${actors.person.userId}> <@${actors.admin.userId}> 준비해요`,
      actors.stranger,
    );
    expect(message.mentionsEveryone).toBe(true);
    expect(message.mentions.map(({ userId }) => userId)).toEqual([
      actors.person.userId,
    ]);
    expect(events.map(({ event }) => event.type)).toEqual([
      "message.created",
      "room.activity",
      "mention.created",
    ]);
    expect(events.slice(1)).toMatchObject([
      {
        channel: `user:${actors.person.userId}`,
        event: {
          type: "room.activity",
          roomKind: "meeting",
          bookingId: booking.id,
          spaceId: null,
          preview: { authorName: actors.stranger.name },
        },
      },
      {
        channel: `user:${actors.person.userId}`,
        event: {
          type: "mention.created",
          roomKind: "meeting",
          bookingId: booking.id,
          spaceId: null,
          roomName: "회의실 A 회의",
        },
      },
    ]);
    expect(events.some(({ channel }) => channel.startsWith("space:"))).toBe(
      false,
    );
    expect(JSON.stringify(events)).not.toContain(actors.person.email);
  });
  it("edits meeting mentions using booking join time and suppresses already-read recipients", async () => {
    const first = await send();
    events.length = 0;
    expect(
      await actions().editMessage({
        messageId: first.id,
        body: `<@${actors.stranger.userId}> 확인해요`,
      }),
    ).toMatchObject({ ok: true });
    expect(
      events.filter(({ event }) => event.type === "mention.created"),
    ).toMatchObject([
      {
        channel: `user:${actors.stranger.userId}`,
        event: {
          bookingId: booking.id,
          roomKind: "meeting",
          roomName: "회의실 A 회의",
        },
      },
    ]);
    expect(
      (await read(actors.stranger).getMeetingView(booking.id))?.room
        .unreadMentions,
    ).toBe(1);
    const second = await send("새 글");
    await actions(actors.stranger).markRoomRead({ roomId, seq: second.seq });
    events.length = 0;
    expect(
      await actions().editMessage({
        messageId: second.id,
        body: `<@${actors.stranger.userId}> 읽은 글 수정`,
      }),
    ).toMatchObject({ ok: true });
    expect(
      events.filter(({ event }) => event.type === "mention.created"),
    ).toEqual([]);
  });
  it("keeps canonical messages and emits nothing on duplicate client ids", async () => {
    const input = {
      roomId,
      body: `<@${actors.stranger.userId}> 원래 글`,
      clientId: crypto.randomUUID(),
    };
    const api = actions();
    const first = await api.sendMessage(input);
    const saved = await database.db.select().from(messageMentions);
    const eventCount = events.length;
    expect(await api.sendMessage({ ...input, body: "바뀐 글" })).toEqual(first);
    expect(events).toHaveLength(eventCount);
    expect(await database.db.select().from(messageMentions)).toEqual(saved);
    expect(await database.db.select().from(messages)).toHaveLength(2);
    expect(publisher.publishMany).toHaveBeenCalledTimes(1);
  });
  it("counts only post-join messages, including system messages, and resets the join boundary on re-add", async () => {
    expect(
      (await read(actors.stranger).getMeetingView(booking.id))?.firstUnreadSeq,
    ).toBeNull();
    await send("처음 메시지");
    expect(
      (await read(actors.stranger).getMeetingView(booking.id))?.firstUnreadSeq,
    ).toBe(2);
    await removeGuest();
    const joined = new Date(now.getTime() + 60_000);
    await database.db.insert(bookingParticipants).values({
      bookingId: booking.id,
      userId: actors.stranger.userId,
      createdAt: joined,
    });
    expect(
      (await read(actors.stranger).getMeetingView(booking.id))?.firstUnreadSeq,
    ).toBeNull();
    await writes.insertSystemMessage(
      {
        roomId,
        actorId: actors.person.userId,
        data: {
          type: "participants_added",
          actorName: actors.person.name,
          names: [actors.stranger.name],
        },
        now: new Date(joined.getTime() + 1),
      },
      database.db,
    );
    expect(
      (await read(actors.stranger).getMeetingView(booking.id))?.firstUnreadSeq,
    ).toBe(3);
    expect(
      (await read(actors.stranger).getMyChatNav()).meetings[0]?.unread,
    ).toBe(true);
    expect(
      await actions(actors.stranger).setRoomMuted({ roomId, muted: true }),
    ).toMatchObject({ ok: true });
    expect(
      await actions(actors.stranger).markRoomRead({ roomId, seq: 3 }),
    ).toEqual({ ok: true, data: { lastReadSeq: 3 } });
    expect(publisher.publish).not.toHaveBeenCalled();
    expect(
      (await read(actors.stranger).getMyChatNav()).meetings[0],
    ).toMatchObject({ unread: false, muted: true });
    expect(
      await database.db
        .select()
        .from(chatRoomReads)
        .where(eq(chatRoomReads.userId, actors.stranger.userId)),
    ).toMatchObject([{ lastReadSeq: 3, muted: true }]);
  });
  it("authorizes meeting capability only for present members, including read-only members", async () => {
    await cancel();
    const capability = async (session: Session) => {
      const createTokenRequest = vi
        .fn<(params: TokenParams, key: string) => Promise<TokenRequest>>()
        .mockResolvedValue({
          keyName: "test.key",
          clientId: session.userId,
          nonce: "nonce",
          timestamp: now.getTime(),
          mac: "fake",
          capability: "{}",
        });
      await createRealtimeToken({
        database: database.db,
        requireSession: async () => session,
        getKey: () => "fake",
        limiter: createMemoryRateLimiter(),
        createTokenRequest,
      })({ rooms: [roomId] });
      return createTokenRequest.mock.calls[0]?.[0];
    };
    expect(await capability(actors.stranger)).toMatchObject({
      capability: { [`room:${roomId}`]: ["subscribe", "presence"] },
    });
    for (const session of [actors.admin, actors.operator])
      expect(await capability(session)).not.toMatchObject({
        capability: { [`room:${roomId}`]: expect.anything() },
      });
    await removeGuest();
    expect(await capability(actors.stranger)).not.toMatchObject({
      capability: { [`room:${roomId}`]: expect.anything() },
    });
  });
});
