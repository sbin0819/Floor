import { eq } from "drizzle-orm";
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
  createChatQueries,
  type ChatQueryDependencies,
} from "@/features/chat/query-factory";
import { emptyMessageDetails } from "@/features/chat/types";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import { createMeetingRoom } from "@/lib/dal/chat-meeting";
import * as meetingRead from "@/lib/dal/chat-meeting-read";
import * as chatRead from "@/lib/dal/chat-read";
import { createTeamSpace, insertSystemMessage } from "@/lib/dal/chat-write";
import {
  bookingParticipants,
  bookings,
  chatRoomReads,
  chatRooms,
  messageMentions,
  messages,
  spacePhotos,
  users,
} from "@/lib/db/schema";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import {
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

const now = new Date("2026-10-08T01:00:00.000Z");
const joinedAt = new Date("2026-10-01T00:00:00.000Z");
const hoursFromNow = (hours: number) =>
  new Date(now.getTime() + hours * 3_600_000);

describe("meeting channel views and navigation", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    actors = await seedBookingActors(database);
  });

  function queries(
    session: Session = actors.person,
    overrides: ChatQueryDependencies = {},
  ) {
    return createChatQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => now,
      limiter: createMemoryRateLimiter(() => now.getTime()),
      ...overrides,
    });
  }

  async function meeting(
    overrides: Partial<typeof bookings.$inferInsert> = {},
    participants: readonly Session[] = [],
  ) {
    const booking = await insertFixtureBooking(database, actors, {
      during: { start: hoursFromNow(1), end: hoursFromNow(2) },
      createdAt: joinedAt,
      title: "가상 디자인 회의",
      attendeeCount: 4,
      ...overrides,
    });
    if (participants.length)
      await database.db.insert(bookingParticipants).values(
        participants.map(({ userId }) => ({
          bookingId: booking.id,
          userId,
          createdAt: joinedAt,
        })),
      );
    const room = await createMeetingRoom(
      { bookingId: booking.id, now: joinedAt },
      database.db,
    );
    await insertSystemMessage(
      {
        roomId: room.id,
        actorId: booking.userId,
        data: { type: "booking_created", actorName: "가상 예약자" },
        now: joinedAt,
      },
      database.db,
    );
    return { booking, room };
  }

  async function fill(roomId: string, count: number) {
    const rows = await database.db
      .insert(messages)
      .values(
        Array.from({ length: count }, (_, index) => ({
          roomId,
          authorId:
            index % 2 === 0 ? actors.person.userId : actors.member.userId,
          seq: index + 2,
          body: `가상 회의 메시지 ${index + 2}`,
          clientId: `meeting-client-${index + 2}`,
          createdAt: new Date(joinedAt.getTime() + (index + 1) * 60_000),
        })),
      )
      .returning();
    await database.db
      .update(chatRooms)
      .set({ lastSeq: count + 1, lastMessageAt: now })
      .where(eq(chatRooms.id, roomId));
    return rows;
  }

  it("returns physical names but no location links, photos or private fields to an invited person without physical access", async () => {
    const { booking, room } = await meeting(
      { spaceId: actors.restrictedFloorSpaceId },
      [actors.member, actors.admin, actors.stranger],
    );
    await database.db.insert(spacePhotos).values({
      spaceId: actors.restrictedFloorSpaceId,
      path: "/seed/photos/private-room.webp",
      alt: "전용 공간 사진",
      sortOrder: 0,
    });
    const data = await queries(actors.stranger).getMeetingView(booking.id);
    expect(data).toEqual({
      call: null,
      canCall: false,
      room: {
        id: room.id,
        lastSeq: 1,
        muted: false,
        unreadMentions: 0,
      },
      booking: {
        id: booking.id,
        title: "가상 디자인 회의",
        spaceName: "8층 비공개 공간",
        floorName: "8F",
        branchName: "강남점",
        timezone: "Asia/Seoul",
        start: hoursFromNow(1).toISOString(),
        end: hoursFromNow(2).toISOString(),
        status: "confirmed",
        attendeeCount: 4,
      },
      user: { id: actors.stranger.userId, name: actors.stranger.name },
      members: [
        { ...actors.person, isBooker: true },
        { ...actors.admin, isBooker: false },
        { ...actors.member, isBooker: false },
        { ...actors.stranger, isBooker: false },
      ].map(({ userId, name, isBooker }) => ({
        userId,
        name,
        isBooker,
        username: null,
        sharesSpace: false,
      })),
      messages: [
        {
          ...emptyMessageDetails(),
          id: expect.any(String),
          seq: 1,
          authorId: null,
          authorName: null,
          kind: "system",
          body: "가상 예약자 님이 예약을 만들었어요",
          systemData: { type: "booking_created", actorName: "가상 예약자" },
          createdAt: joinedAt.toISOString(),
          clientId: null,
        },
      ],
      lastReadSeq: null,
      firstUnreadSeq: null,
      canWrite: true,
      readOnlyReason: null,
      isBooker: false,
      canEditBooking: false,
      now: now.toISOString(),
    });
    const serialized = JSON.stringify(data);
    for (const actor of [
      actors.person,
      actors.admin,
      actors.member,
      actors.stranger,
    ])
      expect(serialized).not.toContain(actor.email);
    for (const privateValue of [
      actors.restrictedFloorSpaceId,
      actors.restrictedFloorId,
      actors.branchId,
      "/seed/photos/",
      '"photo"',
      '"href"',
      '"canMention"',
      '"admin"',
    ])
      expect(serialized).not.toContain(privateValue);
  });

  it("orders the booker first and derives each member's shared-space flag without exposing membership records", async () => {
    await createTeamSpace(actors.teamId, database.db);
    await database.db
      .update(users)
      .set({ username: "member" })
      .where(eq(users.id, actors.member.userId));
    const { booking } = await meeting({}, [actors.member, actors.admin]);
    const data = await queries(actors.member).getMeetingView(booking.id);
    expect(data?.members).toEqual([
      {
        userId: actors.person.userId,
        name: actors.person.name,
        username: null,
        isBooker: true,
        sharesSpace: false,
      },
      {
        userId: actors.admin.userId,
        name: actors.admin.name,
        username: null,
        isBooker: false,
        sharesSpace: true,
      },
      {
        userId: actors.member.userId,
        name: actors.member.name,
        username: "member",
        isBooker: false,
        sharesSpace: true,
      },
    ]);
  });

  it("reads the most recent fifty messages in order and preserves only the viewer's client IDs", async () => {
    const { booking, room } = await meeting({}, [actors.member]);
    await fill(room.id, 60);
    const data = await queries().getMeetingView(booking.id);
    expect(data?.messages.map(({ seq }) => seq)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 12),
    );
    expect(data?.room.lastSeq).toBe(61);
    expect(data?.lastReadSeq).toBe(1);
    expect(data?.firstUnreadSeq).toBe(3);
    expect(data?.messages.length).toBe(50);
    for (const message of data!.messages)
      expect(message.clientId).toBe(
        message.authorId === actors.person.userId
          ? `meeting-client-${message.seq}`
          : null,
      );
  });

  it("returns null before reading messages or members for invalid, missing and inaccessible meetings", async () => {
    const { booking } = await meeting();
    const historical = await insertFixtureBooking(database, actors, {
      during: { start: hoursFromNow(3), end: hoursFromNow(4) },
      createdAt: joinedAt,
    });
    const readMessages = vi.spyOn(chatRead, "listRecentMessages");
    const readMembers = vi.spyOn(meetingRead, "listMeetingMembers");
    expect(await queries().getMeetingView("not-a-uuid")).toBeNull();
    expect(await queries().getMeetingView(crypto.randomUUID())).toBeNull();
    expect(await queries().getMeetingView(historical.id)).toBeNull();
    expect(
      await queries(actors.operator).getMeetingView(booking.id),
    ).toBeNull();
    expect(readMessages).not.toHaveBeenCalled();
    expect(readMembers).not.toHaveBeenCalled();
  });

  it("checks the session before invalid meeting IDs, navigation and pages without issuing SQL", async () => {
    const session = vi.fn(async (): Promise<Session> => {
      throw new ActionError("UNAUTHENTICATED");
    });
    const clock = vi.fn(() => now);
    const read = queries(actors.person, {
      requireSession: session,
      now: clock,
    });
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      await expect(read.getMeetingView("invalid")).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
      await expect(read.getMyChatNav()).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
      await expect(
        read.getRoomMessagesPage("invalid", { after: "0" }),
      ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
      expect(meter.stop().perStage).toEqual([]);
      expect(session).toHaveBeenCalledTimes(3);
      expect(clock).not.toHaveBeenCalled();
    } finally {
      meter.restore();
    }
  });

  it.each([
    { label: "upcoming", start: 1, end: 2, cancelled: false, edit: true },
    { label: "ongoing", start: -1, end: 1, cancelled: false, edit: true },
    {
      label: "exactly ended",
      start: -1,
      end: 0,
      cancelled: false,
      edit: false,
    },
    { label: "cancelled", start: 1, end: 2, cancelled: true, edit: false },
  ])(
    "offers booking editing only to the owner of a live confirmed booking ($label)",
    async ({ start, end, cancelled, edit }) => {
      const { booking } = await meeting(
        {
          during: { start: hoursFromNow(start), end: hoursFromNow(end) },
          ...(cancelled ? { status: "cancelled", cancelledAt: now } : {}),
        },
        [actors.member],
      );
      expect(await queries().getMeetingView(booking.id)).toMatchObject({
        isBooker: true,
        canEditBooking: edit,
      });
      expect(
        await queries(actors.member).getMeetingView(booking.id),
      ).toMatchObject({
        isBooker: false,
        canEditBooking: false,
      });
    },
  );

  it("lists only member meetings inside the strict 24-hour window in start order with all three phases", async () => {
    const ended = await meeting({
      during: { start: hoursFromNow(-2), end: hoursFromNow(-1) },
    });
    const ongoing = await meeting({
      during: { start: hoursFromNow(-0.5), end: hoursFromNow(0.5) },
    });
    const future = await meeting(
      { userId: actors.member.userId, title: null },
      [actors.person],
    );
    await meeting({
      during: { start: hoursFromNow(-25), end: hoursFromNow(-24) },
    });
    await meeting({
      during: { start: hoursFromNow(-27), end: hoursFromNow(-26) },
    });
    await meeting({
      during: { start: hoursFromNow(3), end: hoursFromNow(4) },
      status: "cancelled",
      cancelledAt: now,
    });
    await meeting({
      during: { start: hoursFromNow(5), end: hoursFromNow(6) },
      userId: actors.stranger.userId,
    });
    await insertFixtureBooking(database, actors, {
      during: { start: hoursFromNow(7), end: hoursFromNow(8) },
    });
    const nav = await queries().getMyChatNav();
    expect(nav.meetings).toEqual(
      [
        [ended, "ended"],
        [ongoing, "ongoing"],
        [future, "upcoming"],
      ].map(([entry, phase]) => {
        const { booking, room } = entry as typeof ended;
        return {
          bookingId: booking.id,
          roomId: room.id,
          title: booking.title,
          spaceName: "회의실 B",
          start: booking.during.start.toISOString(),
          end: booking.during.end.toISOString(),
          timezone: "Asia/Seoul",
          phase,
          unread: false,
          unreadMentions: 0,
          muted: false,
        };
      }),
    );
    expect(nav.now).toBe(now.toISOString());
    expect(nav.directMessages).toEqual([]);
    expect(JSON.stringify(nav)).not.toContain("@");
  });

  it("retains unread and mention values on a muted meeting without adding DM unread counts", async () => {
    const { booking, room } = await meeting({}, [actors.member]);
    const rows = await fill(room.id, 2);
    await database.db.insert(messageMentions).values({
      messageId: rows[1]!.id,
      userId: actors.person.userId,
      createdAt: now,
    });
    await database.db
      .update(chatRoomReads)
      .set({ muted: true })
      .where(eq(chatRoomReads.roomId, room.id));
    const nav = await queries().getMyChatNav();
    expect(nav.meetings).toEqual([
      {
        bookingId: booking.id,
        roomId: room.id,
        title: booking.title,
        spaceName: "회의실 B",
        start: booking.during.start.toISOString(),
        end: booking.during.end.toISOString(),
        timezone: "Asia/Seoul",
        phase: "upcoming",
        unread: true,
        unreadMentions: 1,
        muted: true,
      },
    ]);
    expect((await queries().getMeetingView(booking.id))?.room).toEqual({
      id: room.id,
      lastSeq: 3,
      muted: true,
      unreadMentions: 1,
    });
  });

  it("keeps view [1,2], page [2] and navigation [4] budgets when more than twenty meeting rooms exist", async () => {
    const first = await meeting({}, [actors.member]);
    await fill(first.room.id, 60);
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const initial = await queries().getMyChatNav();
      expect(meter.stop().perStage).toEqual([4]);
      expect(initial.meetings).toHaveLength(1);

      const bookingIds = [first.booking.id];
      for (let index = 1; index < 25; index += 1) {
        const added = await meeting(
          {
            during: {
              start: hoursFromNow(index + 1),
              end: hoursFromNow(index + 2),
            },
          },
          [actors.member],
        );
        bookingIds.push(added.booking.id);
      }
      meter.start();
      const grown = await queries().getMyChatNav();
      expect(meter.stop().perStage).toEqual([4]);
      expect(grown.meetings.map(({ bookingId }) => bookingId)).toEqual(
        bookingIds.slice(0, 20),
      );

      meter.start();
      const view = await queries().getMeetingView(first.booking.id);
      expect(meter.stop().perStage).toEqual([1, 2]);
      expect(view?.messages).toHaveLength(50);
      expect(view?.members).toHaveLength(2);

      meter.start();
      const page = await queries().getRoomMessagesPage(first.room.id, {
        before: "12",
      });
      expect(meter.stop().perStage).toEqual([2]);
      expect(page).toMatchObject({
        lastSeq: 61,
        lastReadSeq: 1,
        firstUnreadSeq: 3,
        peerReadSeq: null,
        hasMore: false,
      });
      expect(page.messages.map(({ seq }) => seq)).toEqual(
        Array.from({ length: 11 }, (_, index) => index + 1),
      );
      expect(page.messages[1]?.clientId).toBe("meeting-client-2");
      expect(page.messages[2]?.clientId).toBeNull();
    } finally {
      meter.restore();
    }
  });
});
