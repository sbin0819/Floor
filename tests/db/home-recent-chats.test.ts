import { and, eq, inArray } from "drizzle-orm";
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
import { createHomeRecentQueries } from "@/features/home/recent-query-factory";
import { ActionError } from "@/lib/actions/result";
import { avatarColorFor } from "@/lib/avatar";
import * as recent from "@/lib/dal/home-recent-chats";
import {
  bookingParticipants,
  bookings,
  chatRoomMembers,
  chatRoomReads,
  chatRooms,
  chatSpacePrefs,
  chatSpaces,
  messageMentions,
  messages,
  teamMembers,
  userBlocks,
} from "@/lib/db/schema";
import { createMeetingRoom } from "@/lib/dal/chat-meeting";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";
import { insertFixtureBooking, seedBookingActors } from "./booking-helper";
import {
  addHomeRecentMessage,
  addHomeRecentRoom,
  homeRecentJoined,
  homeRecentNow,
  seedHomeRecentChats,
} from "./home-recent-helper";

describe("home recent conversations", () => {
  let database: TestDatabase;
  let fixture: Awaited<ReturnType<typeof seedHomeRecentChats>>;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    fixture = await seedHomeRecentChats(database);
  });
  afterEach(() => vi.restoreAllMocks());
  const read = () =>
    createHomeRecentQueries({
      database: database.db,
      requireSession: async () => fixture.session,
      now: () => homeRecentNow,
    }).getHomeRecentChats();
  const setRead = (roomId: string, seq: number, muted = false) =>
    database.db
      .insert(chatRoomReads)
      .values({
        roomId,
        userId: fixture.userId,
        lastReadSeq: seq,
        muted,
        updatedAt: homeRecentNow,
      })
      .onConflictDoUpdate({
        target: [chatRoomReads.roomId, chatRoomReads.userId],
        set: { lastReadSeq: seq, muted },
      });
  const block = (blockerId: string, blockedId: string) =>
    database.db
      .insert(userBlocks)
      .values({ blockerId, blockedId, createdAt: homeRecentNow });

  it("checks session before SQL, clock, and each data loader", async () => {
    const sql = vi.spyOn(database.client, "query");
    const clock = vi.fn(() => homeRecentNow);
    const direct = vi.spyOn(recent, "readHomeDirectChats");
    await expect(
      createHomeRecentQueries({
        database: database.db,
        now: clock,
        requireSession: async () => {
          throw new ActionError("UNAUTHENTICATED");
        },
      }).getHomeRecentChats(),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(sql).not.toHaveBeenCalled();
    expect(clock).not.toHaveBeenCalled();
    expect(direct).not.toHaveBeenCalled();
  });

  it("returns three ordered minimal rows with names, avatars and attachment summaries", async () => {
    const rows = await read();
    expect(rows).toEqual([
      {
        roomId: fixture.mentionRoomId,
        kind: "mention",
        href: `/s/${fixture.spaceId}/${fixture.mentionRoomId}?message=${fixture.mentionMessage.id}`,
        title: "박지훈",
        subtitle: `# 일반 · ${fixture.teamName}`,
        avatar: {
          person: {
            name: "박지훈",
            color: avatarColorFor(fixture.peerId, null),
            photoUrl: null,
          },
        },
        excerpt: "@보는 사람 확인해 주세요",
        at: fixture.mentionMessage.createdAt.toISOString(),
        unreadCount: 1,
        mention: true,
      },
      {
        roomId: fixture.groupId,
        kind: "group_dm",
        href: `/dm/${fixture.groupId}`,
        title: "박지훈, 이서연",
        subtitle: "그룹 · 3명",
        avatar: { group: true },
        excerpt: "이서연: 사진 2장",
        at: fixture.groupMessage.createdAt.toISOString(),
        unreadCount: 1,
        mention: false,
      },
      {
        roomId: fixture.dmId,
        kind: "dm",
        href: `/dm/${fixture.dmId}`,
        title: "박지훈",
        subtitle: "DM",
        avatar: {
          person: {
            name: "박지훈",
            color: avatarColorFor(fixture.peerId, null),
            photoUrl: null,
          },
        },
        excerpt: "안녕하세요 @보는 사람 반가워요",
        at: fixture.dmMessage.createdAt.toISOString(),
        unreadCount: 1,
        mention: false,
      },
    ]);
    expect(JSON.stringify(rows)).not.toMatch(
      /example\.test|storageKey|uploaderId|clientId|authorId/,
    );
  });

  it("keeps DM mentioned messages once and selects only the latest unread mention in each room", async () => {
    const latest = await addHomeRecentMessage(
      database,
      fixture.mentionRoomId,
      fixture.otherId,
      { body: "<@everyone> 최신", mentionsEveryone: true },
    );
    await database.db
      .insert(messageMentions)
      .values({ messageId: latest.id, userId: fixture.userId });
    const rows = await read();
    expect(rows.map((row) => row.roomId)).toEqual([
      fixture.mentionRoomId,
      fixture.groupId,
      fixture.dmId,
    ]);
    expect(rows[0]).toMatchObject({
      title: "이서연",
      excerpt: "@모두 최신",
      unreadCount: 2,
    });
    expect(rows.filter((row) => row.roomId === fixture.dmId)).toHaveLength(1);
  });

  it.each(["requested", "declined", "left"] as const)(
    "excludes a %s DM without losing eligible older rows",
    async (status) => {
      await database.db
        .update(chatRoomMembers)
        .set({
          status,
          ...(status === "requested" || status === "declined"
            ? { requestedAt: homeRecentNow }
            : {}),
        })
        .where(
          and(
            eq(chatRoomMembers.roomId, fixture.dmId),
            eq(chatRoomMembers.userId, fixture.userId),
          ),
        );
      expect((await read()).map((row) => row.roomId)).not.toContain(
        fixture.dmId,
      );
    },
  );

  it("hides only viewer-blocked DMs and never reveals the reverse block", async () => {
    await block(fixture.peerId, fixture.userId);
    expect(
      (await read()).find((row) => row.roomId === fixture.dmId)?.excerpt,
    ).toContain("안녕하세요");
    await block(fixture.userId, fixture.peerId);
    const rows = await read();
    expect(rows.map((row) => row.roomId)).not.toContain(fixture.dmId);
    expect(rows.map((row) => row.roomId)).not.toContain(fixture.mentionRoomId);
    expect(rows[0]?.excerpt).toBe("이서연: 사진 2장");
  });

  it("falls back past blocked group authors, keeps ordering time, and uses the neutral fallback if none remain", async () => {
    await addHomeRecentMessage(database, fixture.groupId, fixture.peerId, {
      body: "노출 금지 최신",
    });
    await block(fixture.userId, fixture.peerId);
    expect((await read())[0]).toMatchObject({
      roomId: fixture.groupId,
      excerpt: "이서연: 사진 2장",
      at: homeRecentNow.toISOString(),
    });
    await block(fixture.userId, fixture.otherId);
    expect(await read()).toMatchObject([
      { roomId: fixture.groupId, excerpt: "메시지" },
    ]);
  });

  it("formats deleted and system messages without leaking the old body or adding a fake author", async () => {
    await database.db
      .update(messages)
      .set({ body: "", deletedAt: homeRecentNow, deletedBy: fixture.userId })
      .where(eq(messages.id, fixture.groupMessage.id));
    expect(
      (await read()).find((row) => row.roomId === fixture.groupId)?.excerpt,
    ).toBe("삭제된 메시지예요");
    await addHomeRecentMessage(database, fixture.groupId, fixture.userId, {
      kind: "system",
      authorId: null,
      body: "저장된 임의 본문",
      systemData: { type: "group_created", actorName: "김하은" },
    });
    expect((await read())[0]?.excerpt).toBe("김하은 님이 그룹을 만들었어요");
  });

  it("counts muted mentions but excludes read, own, deleted and pre-join mentions", async () => {
    await setRead(fixture.mentionRoomId, 0, true);
    await database.db.insert(chatSpacePrefs).values({
      spaceId: fixture.spaceId,
      userId: fixture.userId,
      muted: true,
      updatedAt: homeRecentNow,
    });
    expect((await read())[0]).toMatchObject({
      roomId: fixture.mentionRoomId,
      unreadCount: 1,
    });
    await setRead(fixture.mentionRoomId, 1, true);
    await addHomeRecentMessage(
      database,
      fixture.mentionRoomId,
      fixture.userId,
      { mentionsEveryone: true },
    );
    await addHomeRecentMessage(
      database,
      fixture.mentionRoomId,
      fixture.peerId,
      { mentionsEveryone: true, body: "", deletedAt: homeRecentNow },
    );
    await addHomeRecentMessage(
      database,
      fixture.mentionRoomId,
      fixture.peerId,
      { mentionsEveryone: true, createdAt: homeRecentJoined },
    );
    expect((await read()).map((row) => row.roomId)).not.toContain(
      fixture.mentionRoomId,
    );
  });

  it.each(["archived", "deleted_space", "left_team"] as const)(
    "does not read %s channel content",
    async (caseName) => {
      if (caseName === "archived")
        await database.db
          .update(chatRooms)
          .set({ archivedAt: homeRecentNow })
          .where(eq(chatRooms.id, fixture.mentionRoomId));
      if (caseName === "deleted_space")
        await database.db
          .update(chatSpaces)
          .set({ deletedAt: homeRecentNow })
          .where(eq(chatSpaces.id, fixture.spaceId));
      if (caseName === "left_team")
        await database.db
          .delete(teamMembers)
          .where(
            and(
              eq(teamMembers.teamId, fixture.teamId),
              eq(teamMembers.userId, fixture.userId),
            ),
          );
      const names = vi.spyOn(recent, "readHomeMentionNames");
      expect((await read()).map((row) => row.roomId)).not.toContain(
        fixture.mentionRoomId,
      );
      expect(names.mock.calls[0]?.[0]).not.toContain(fixture.mentionMessage.id);
    },
  );

  it("applies read authorization before top three even with newer inaccessible rooms", async () => {
    const [unreadableSpace] = await database.db
      .insert(chatSpaces)
      .values({ kind: "community", name: "비공개", createdBy: fixture.peerId })
      .returning();
    for (let index = 0; index < 5; index += 1) {
      const [room] = await database.db
        .insert(chatRooms)
        .values({
          kind: "text",
          spaceId: fixture.spaceId,
          name: `제외${index}`,
          archivedAt: homeRecentNow,
        })
        .returning();
      await addHomeRecentMessage(database, room!.id, fixture.peerId, {
        mentionsEveryone: true,
      });
      const [hidden] = await database.db
        .insert(chatRooms)
        .values({
          kind: "text",
          spaceId: unreadableSpace!.id,
          name: `권한 없음${index}`,
        })
        .returning();
      await addHomeRecentMessage(database, hidden!.id, fixture.peerId, {
        body: "노출 금지",
        mentionsEveryone: true,
      });
    }
    expect((await read()).map((row) => row.roomId)).toEqual([
      fixture.mentionRoomId,
      fixture.groupId,
      fixture.dmId,
    ]);
  });

  it("excludes empty and left groups while preserving current group names", async () => {
    const emptyId = await addHomeRecentRoom(
      database,
      fixture.userId,
      fixture.peerId,
    );
    await database.db
      .update(chatRooms)
      .set({ name: "점심 모임" })
      .where(eq(chatRooms.id, fixture.groupId));
    expect(
      (await read()).find((row) => row.roomId === fixture.groupId),
    ).toMatchObject({ title: "점심 모임", subtitle: "그룹 · 3명" });
    expect((await read()).map((row) => row.roomId)).not.toContain(emptyId);
    await database.db
      .update(chatRoomMembers)
      .set({ status: "left" })
      .where(
        and(
          eq(chatRoomMembers.roomId, fixture.groupId),
          eq(chatRoomMembers.userId, fixture.userId),
        ),
      );
    expect((await read()).map((row) => row.roomId)).not.toContain(
      fixture.groupId,
    );
  });

  it("uses the same mention rules for readable voice channels", async () => {
    const [voice] = await database.db
      .insert(chatRooms)
      .values({
        kind: "voice",
        spaceId: fixture.spaceId,
        name: "음성 모임",
        voiceCapacity: 10,
      })
      .returning();
    await addHomeRecentMessage(database, voice!.id, fixture.peerId, {
      mentionsEveryone: true,
      body: "<@everyone> 음성 안내",
    });
    expect((await read())[0]).toMatchObject({
      roomId: voice!.id,
      kind: "mention",
      subtitle: `# 음성 모임 · ${fixture.teamName}`,
      excerpt: "@모두 음성 안내",
    });
  });

  it("keeps meeting mentions only for a current participant and within the strict 24-hour confirmed window", async () => {
    const actors = await seedBookingActors(database);
    fixture = await seedHomeRecentChats(database);
    const end = new Date(homeRecentNow.getTime() - 86_400_000 + 1);
    const booking = await insertFixtureBooking(database, actors, {
      createdAt: homeRecentJoined,
      during: { start: new Date(end.getTime() - 3_600_000), end },
      title: "회의 이름",
    });
    await database.db.insert(bookingParticipants).values({
      bookingId: booking.id,
      userId: fixture.userId,
      createdAt: homeRecentJoined,
    });
    const meeting = await createMeetingRoom(
      { bookingId: booking.id, now: homeRecentJoined },
      database.db,
    );
    await addHomeRecentMessage(database, meeting.id, fixture.peerId, {
      mentionsEveryone: true,
      body: "회의 안내",
    });
    expect((await read())[0]).toMatchObject({
      roomId: meeting.id,
      kind: "mention",
      href: `/m/${booking.id}`,
      subtitle: "회의 이름",
    });
    await database.db
      .update(bookings)
      .set({ title: null })
      .where(eq(bookings.id, booking.id));
    expect((await read())[0]?.subtitle).toMatch(/ 회의$/u);
    await database.db
      .update(bookings)
      .set({
        during: {
          start: new Date(end.getTime() - 3_600_000),
          end: new Date(end.getTime() - 1),
        },
      })
      .where(eq(bookings.id, booking.id));
    expect((await read()).map((row) => row.roomId)).not.toContain(meeting.id);
    await database.db
      .update(bookings)
      .set({ during: { start: new Date(end.getTime() - 3_600_000), end } })
      .where(eq(bookings.id, booking.id));
    await database.db
      .delete(bookingParticipants)
      .where(eq(bookingParticipants.bookingId, booking.id));
    expect((await read()).map((row) => row.roomId)).not.toContain(meeting.id);
    await database.db
      .insert(bookingParticipants)
      .values({
        bookingId: booking.id,
        userId: fixture.userId,
        createdAt: homeRecentJoined,
      });
    await database.db
      .update(bookings)
      .set({
        status: "cancelled",
        cancelledAt: homeRecentNow,
        cancelledBy: actors.person.userId,
      })
      .where(eq(bookings.id, booking.id));
    expect((await read()).map((row) => row.roomId)).not.toContain(meeting.id);
  });

  it("uses two stages with two statements each for populated data and a larger room set", async () => {
    const meter = createQueryMeter(database.client);
    try {
      for (const expanded of [false, true]) {
        if (expanded)
          for (let index = 0; index < 12; index += 1) {
            const roomId = await addHomeRecentRoom(
              database,
              fixture.userId,
              fixture.peerId,
            );
            await addHomeRecentMessage(database, roomId, fixture.peerId, {
              createdAt: new Date(homeRecentNow.getTime() - 60_000 - index),
            });
          }
        meter.start();
        const rows = await read();
        expect(meter.stop()).toEqual({
          stages: 2,
          statements: 4,
          perStage: [2, 2],
        });
        expect(rows.map((row) => row.kind)).toEqual([
          "mention",
          "group_dm",
          "dm",
        ]);
      }
    } finally {
      meter.restore();
    }
  });

  it("passes only the selected message IDs to the two enrichment reads", async () => {
    const excluded = await addHomeRecentRoom(
      database,
      fixture.userId,
      fixture.peerId,
    );
    const old = await addHomeRecentMessage(database, excluded, fixture.peerId, {
      createdAt: homeRecentJoined,
    });
    const names = vi.spyOn(recent, "readHomeMentionNames");
    const files = vi.spyOn(recent, "readHomeMessageAttachments");
    await read();
    expect(names.mock.calls[0]?.[0]).toEqual([
      fixture.mentionMessage.id,
      fixture.groupMessage.id,
      fixture.dmMessage.id,
    ]);
    expect(files.mock.calls[0]?.[0]).toEqual(names.mock.calls[0]?.[0]);
    expect(files.mock.calls[0]?.[0]).not.toContain(old.id);
  });

  it("skips the second stage when no visible message remains", async () => {
    await database.db
      .update(chatRoomMembers)
      .set({ status: "left" })
      .where(
        and(
          eq(chatRoomMembers.userId, fixture.userId),
          inArray(chatRoomMembers.roomId, [fixture.dmId, fixture.groupId]),
        ),
      );
    await setRead(fixture.mentionRoomId, 1);
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      expect(await read()).toEqual([]);
      expect(meter.stop().perStage).toEqual([2]);
    } finally {
      meter.restore();
    }
  });
});
