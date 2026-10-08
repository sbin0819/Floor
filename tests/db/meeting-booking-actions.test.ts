import { eq } from "drizzle-orm";
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
import { createBookingActions } from "@/features/bookings/create-booking-factory";
import { createUpdateBookingAction } from "@/features/bookings/update-booking-factory";
import { createCancelBookingAction } from "@/features/bookings/cancel-booking-factory";
import { createLeaveBookingAction } from "@/features/bookings/leave-booking-factory";
import { createDeskBookingAction } from "@/features/bookings/create-desk-booking-factory";
import { assertParticipantsLocked } from "@/features/bookings/participant-transaction";
import * as meetingDal from "@/lib/dal/chat-meeting";
import type { Session } from "@/lib/auth/types";
import * as schema from "@/lib/db/schema";
import {
  bookings,
  bookingParticipants,
  chatRooms,
  chatRoomReads,
  messages,
} from "@/lib/db/schema";
import type { RealtimeItem } from "@/lib/realtime/types";
import { createTestDatabase, type TestDatabase } from "./helper";
import {
  bookingInput,
  bookingInstant,
  bookingNow,
  bookingDate,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";

describe("meeting lifecycle inside reservation transactions", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  const events: RealtimeItem[] = [];
  const sqlLog: string[] = [];
  const floorPublish = vi.fn();
  const publishMany = vi.fn(async (items: readonly RealtimeItem[]) => {
    events.push(...items);
  });
  const later = new Date(bookingNow.getTime() + 60_000);
  beforeAll(async () => {
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema,
      logger: { logQuery: (text) => sqlLog.push(text) },
    });
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    actors = await seedBookingActors(database);
    events.length = 0;
    sqlLog.length = 0;
  });
  const deps = (session = actors.person, now = bookingNow) => ({
    database: database.db,
    getSession: async () => session,
    now: () => now,
    publisher: { publish: floorPublish },
    chatPublisher: { publish: vi.fn(), publishMany },
    logError: vi.fn(),
  });
  const readBooking = async (id: string) =>
    (await database.db.select().from(bookings).where(eq(bookings.id, id)))[0]!;
  const readRoom = async (id: string) =>
    (
      await database.db
        .select()
        .from(chatRooms)
        .where(eq(chatRooms.bookingId, id))
    )[0]!;
  const history = async (bookingId: string) => {
    const room = await readRoom(bookingId);
    return room
      ? database.db
          .select()
          .from(messages)
          .where(eq(messages.roomId, room.id))
          .orderBy(messages.seq)
      : [];
  };
  const guests = (...people: Session[]) =>
    people.map(({ userId, email }) => ({ userId, email }));
  async function create(
    people: Session[] = [],
    owner = actors.person,
    teamId: string | null = null,
  ) {
    const result = await createBookingActions(deps(owner)).createBooking({
      ...bookingInput(actors, {
        start: bookingInstant("13:00"),
        end: bookingInstant("14:00"),
        teamId,
      }),
      participants: guests(...people),
    });
    if (!result.ok) throw new Error(`create failed ${result.code}`);
    return readBooking(result.data.bookingId);
  }
  const draft = (
    booking: typeof bookings.$inferSelect,
    people: Session[] = [],
  ) => ({
    bookingId: booking.id,
    start: booking.during.start.toISOString(),
    end: booking.during.end.toISOString(),
    title: booking.title ?? undefined,
    attendeeCount: booking.attendeeCount,
    participants: guests(...people),
    participantIdsAtLoad: people.map(({ userId }) => userId),
  });

  it.each([false, true])(
    "creates a room and one system message with participants=%s after all reservation writes",
    async (withGuests) => {
      const booking = await create(withGuests ? [actors.stranger] : []);
      const room = await readRoom(booking.id);
      expect(room).toMatchObject({
        kind: "meeting",
        bookingId: booking.id,
        lastSeq: 1,
        createdAt: bookingNow,
      });
      expect(await history(booking.id)).toMatchObject([
        {
          seq: 1,
          kind: "system",
          authorId: null,
          createdAt: bookingNow,
          systemData: {
            type: "booking_created",
            actorName: actors.person.name,
          },
        },
      ]);
      expect(await database.db.select().from(chatRoomReads)).toMatchObject([
        { userId: actors.person.userId, lastReadSeq: 1 },
      ]);
      expect(floorPublish).toHaveBeenCalledTimes(1);
      expect(publishMany).toHaveBeenCalledTimes(1);
      expect(events.map(({ event }) => event.type)).toEqual(
        withGuests ? ["message.created", "room.activity"] : ["message.created"],
      );
      if (withGuests)
        expect(events[1]).toMatchObject({
          channel: `user:${actors.stranger.userId}`,
          event: {
            bookingId: booking.id,
            roomKind: "meeting",
            authorId: null,
            preview: { authorName: null },
          },
        });
      const roomLock = sqlLog.findIndex((text) =>
        /from "chat_rooms".*for update/.test(text),
      );
      expect(roomLock).toBeGreaterThan(
        sqlLog.findIndex((text) => text.startsWith('insert into "bookings"')),
      );
      expect(roomLock).toBeGreaterThan(
        sqlLog.findIndex((text) =>
          /update "users" set "default_branch_id"/.test(text),
        ),
      );
      expect(
        sqlLog
          .slice(roomLock + 1)
          .some((text) =>
            /from "(users|teams|bookings|spaces|floors)".*for (update|key share)/.test(
              text,
            ),
          ),
      ).toBe(false);
      expect(JSON.stringify(events)).not.toContain(actors.stranger.email);
    },
  );

  it("does not create meeting rows for desk reservations or rejected time reservations", async () => {
    expect(
      await createDeskBookingAction(deps())({
        deskId: actors.deskId,
        date: bookingDate,
        part: "pm",
        teamId: null,
      }),
    ).toMatchObject({ ok: true });
    expect(await database.db.select().from(chatRooms)).toEqual([]);
    await insertFixtureBooking(database, actors, {
      during: bookingRange("13:00", "14:00"),
    });
    const result = await createBookingActions(deps()).createBooking(
      bookingInput(actors, {
        start: bookingInstant("13:00"),
        end: bookingInstant("14:00"),
      }),
    );
    expect(result).toMatchObject({ ok: false, code: "BOOKING_CONFLICT" });
    expect(await database.db.select().from(chatRooms)).toEqual([]);
    expect(events).toEqual([]);
  });

  it("appends time, additions and removals in order, sends revocation first and excludes the actor", async () => {
    const original = await create([actors.admin, actors.stranger]);
    const input = draft(original, [actors.admin, actors.stranger]);
    events.length = 0;
    publishMany.mockClear();
    floorPublish.mockClear();
    sqlLog.length = 0;
    const result = await createUpdateBookingAction(deps(actors.person, later))({
      ...input,
      start: bookingInstant("14:00"),
      end: bookingInstant("15:00"),
      participants: guests(actors.member, actors.otherMember),
    });
    expect(result).toMatchObject({ ok: true });
    const rows = await history(original.id);
    expect(rows.map(({ seq }) => seq)).toEqual([1, 2, 3, 4]);
    expect(rows.slice(1).map(({ systemData }) => systemData?.type)).toEqual([
      "booking_time_changed",
      "participants_added",
      "participant_removed",
    ]);
    expect(rows[2]?.systemData).toEqual({
      type: "participants_added",
      actorName: actors.person.name,
      names: [actors.member.name, actors.otherMember.name].sort(),
    });
    expect(rows[3]?.systemData).toEqual({
      type: "participant_removed",
      actorName: actors.person.name,
      names: [actors.admin.name, actors.stranger.name].sort(),
    });
    expect(rows[1]?.systemData).toMatchObject({
      previousStart: original.during.start.toISOString(),
      start: new Date(bookingInstant("14:00")).toISOString(),
      timezone: "Asia/Seoul",
    });
    expect(
      events
        .slice(0, 2)
        .map(({ channel }) => channel)
        .sort(),
    ).toEqual(
      [`user:${actors.admin.userId}`, `user:${actors.stranger.userId}`].sort(),
    );
    expect(events.map(({ event }) => event.type)).toEqual([
      "realtime.reauth",
      "realtime.reauth",
      "message.created",
      "message.created",
      "message.created",
      ...Array(6).fill("room.activity"),
      "room.changed",
    ]);
    expect(
      events
        .filter(({ event }) => event.type === "room.activity")
        .every(({ channel }) =>
          [actors.member.userId, actors.otherMember.userId].some(
            (id) => channel === `user:${id}`,
          ),
        ),
    ).toBe(true);
    expect((await database.db.select().from(chatRoomReads))[0]).toMatchObject({
      userId: actors.person.userId,
      lastReadSeq: 4,
    });
    expect(floorPublish).toHaveBeenCalledTimes(1);
    expect(publishMany).toHaveBeenCalledTimes(1);
    const lock = sqlLog.findIndex((text) =>
      /from "chat_rooms".*for update/.test(text),
    );
    expect(lock).toBeGreaterThan(
      sqlLog.findLastIndex((text) => /from "bookings".*for update/.test(text)),
    );
    expect(
      sqlLog.filter((text) => /^select "id", "name" from "users"/.test(text)),
    ).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(actors.stranger.email);
  });

  it("changes only the header for title or count edits, and emits nothing for identical values", async () => {
    const booking = await create();
    events.length = 0;
    await createUpdateBookingAction(deps())({
      ...draft(booking),
      title: "새 제목",
      attendeeCount: 2,
    });
    expect(await history(booking.id)).toHaveLength(1);
    expect(events).toEqual([
      {
        channel: `room:${(await readRoom(booking.id)).id}`,
        event: {
          type: "room.changed",
          roomId: (await readRoom(booking.id)).id,
        },
      },
    ]);
    events.length = 0;
    await createUpdateBookingAction(deps())(
      draft(await readBooking(booking.id)),
    );
    expect(events).toEqual([]);
  });

  it.each(["owner", "operator", "team-admin"] as const)(
    "only advances a meeting member's cursor when cancelled by %s",
    async (who) => {
      const owner = who === "team-admin" ? actors.member : actors.person;
      const booking = await create(
        [actors.stranger],
        owner,
        who === "team-admin" ? actors.teamId : null,
      );
      const actor =
        who === "owner"
          ? owner
          : who === "operator"
            ? actors.operator
            : actors.admin;
      events.length = 0;
      expect(
        await createCancelBookingAction(deps(actor, later))({
          bookingId: booking.id,
        }),
      ).toMatchObject({ ok: true });
      expect((await history(booking.id))[1]).toMatchObject({
        systemData: { type: "booking_cancelled", actorName: actor.name },
      });
      const cursors = await database.db.select().from(chatRoomReads);
      expect(cursors).toHaveLength(1);
      expect(cursors[0]).toMatchObject({
        userId: owner.userId,
        lastReadSeq: who === "owner" ? 2 : 1,
      });
      expect(
        events.filter(({ event }) => event.type === "room.activity"),
      ).toHaveLength(who === "owner" ? 1 : 2);
    },
  );

  it("removes a participant, revokes first and never creates a departed actor cursor", async () => {
    const booking = await create([actors.stranger, actors.member]);
    events.length = 0;
    expect(
      await createLeaveBookingAction(deps(actors.stranger, later))({
        bookingId: booking.id,
      }),
    ).toMatchObject({ ok: true });
    expect((await history(booking.id))[1]).toMatchObject({
      systemData: { type: "participant_left", name: actors.stranger.name },
    });
    expect(events[0]).toEqual({
      channel: `user:${actors.stranger.userId}`,
      event: { type: "realtime.reauth" },
    });
    expect(events.map(({ event }) => event.type)).toEqual([
      "realtime.reauth",
      "message.created",
      "room.activity",
      "room.activity",
      "room.changed",
    ]);
    expect(
      (await database.db.select().from(chatRoomReads)).map(
        ({ userId }) => userId,
      ),
    ).toEqual([actors.person.userId]);
  });

  it.each(["update", "cancel", "leave"] as const)(
    "never retroactively creates an absent room on %s",
    async (action) => {
      const booking = await insertFixtureBooking(database, actors, {
        during: bookingRange("13:00", "14:00"),
      });
      if (action === "leave")
        await database.db.insert(bookingParticipants).values({
          bookingId: booking.id,
          userId: actors.stranger.userId,
          createdAt: bookingNow,
        });
      const result =
        action === "update"
          ? await createUpdateBookingAction(deps())({
              ...draft(booking),
              title: "이름만",
            })
          : action === "cancel"
            ? await createCancelBookingAction(deps())({ bookingId: booking.id })
            : await createLeaveBookingAction(deps(actors.stranger))({
                bookingId: booking.id,
              });
      expect(result).toMatchObject({ ok: true });
      expect(events).toEqual([]);
      expect(await database.db.select().from(chatRooms)).toEqual([]);
    },
  );

  it.each(["update", "cancel"] as const)(
    "discards rolled-back %s snapshots and publishes only the committed retry once",
    async (action) => {
      const booking = await create();
      events.length = 0;
      publishMany.mockClear();
      floorPublish.mockClear();
      const original = meetingDal.recordMeetingMessages;
      vi.spyOn(meetingDal, "recordMeetingMessages").mockImplementationOnce(
        async (...args) => {
          await original(...args);
          assertParticipantsLocked([], [crypto.randomUUID()]);
          return [];
        },
      );
      const result =
        action === "update"
          ? await createUpdateBookingAction(deps())({
              ...draft(booking),
              start: bookingInstant("14:00"),
              end: bookingInstant("15:00"),
            })
          : await createCancelBookingAction(deps())({ bookingId: booking.id });
      expect(result).toMatchObject({ ok: true });
      expect(await history(booking.id)).toHaveLength(2);
      expect(
        events.filter(({ event }) => event.type === "message.created"),
      ).toHaveLength(1);
      expect(
        events.find(({ event }) => event.type === "message.created")?.event,
      ).toMatchObject({ seq: 2 });
      expect(publishMany).toHaveBeenCalledTimes(1);
      expect(floorPublish).toHaveBeenCalledTimes(1);
    },
  );

  it("rolls creation back when writing the system message fails", async () => {
    const original = meetingDal.recordMeetingMessages;
    vi.spyOn(meetingDal, "recordMeetingMessages").mockImplementationOnce(
      async (...args) => {
        await original(...args);
        throw new Error("private fault");
      },
    );
    expect(
      await createBookingActions(deps()).createBooking(bookingInput(actors)),
    ).toMatchObject({ ok: false, code: "INTERNAL" });
    for (const table of [bookings, chatRooms, messages, chatRoomReads])
      expect(await database.db.select().from(table)).toEqual([]);
    expect(events).toEqual([]);
    expect(floorPublish).not.toHaveBeenCalled();
  });

  it("keeps the committed reservation if chat publication fails without retrying the write", async () => {
    publishMany.mockRejectedValueOnce(new Error("private publication failure"));
    const booking = await create();
    expect(await history(booking.id)).toHaveLength(1);
    expect(publishMany).toHaveBeenCalledTimes(1);
    expect(floorPublish).toHaveBeenCalledTimes(1);
  });
});
