import { and, eq, sql } from "drizzle-orm";
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
  createFileQueries,
  type FileQueryDependencies,
} from "@/features/chat/file-query-factory";
import { createFileDownloads } from "@/features/chat/files";
import { UPLOAD_LIFETIME_MS } from "@/features/chat/upload-types";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import * as fileDal from "@/lib/dal/chat-files";
import {
  bookingParticipants,
  bookings,
  branches,
  chatRoomMembers,
  chatRooms,
  chatSpaces,
  floors,
  messageAttachments,
  messages,
  spaces,
  teamMembers,
  userBlocks,
} from "@/lib/db/schema";
import {
  createMemoryRateLimiter,
  RateLimitError,
} from "@/lib/rate-limit/memory";
import type { FileStorage } from "@/lib/storage/types";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("room files and protected downloads", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  let storage: FileStorage;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await database.db.execute(sql`truncate users, branches cascade`);
    actors = await seedChatActors(database);
    storage = {
      kind: "local",
      createUploadTarget: vi.fn(),
      readHead: vi.fn(),
      remove: vi.fn(),
      stat: vi.fn(async () => ({ size: 5 })),
      readStream: vi.fn(
        async () =>
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("hello"));
              controller.close();
            },
          }),
      ),
    };
  });
  function queries(
    session: Session = actors.member,
    overrides: FileQueryDependencies = {},
  ) {
    return createFileQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => chatNow,
      limiter: createMemoryRateLimiter(() => chatNow.getTime()),
      ...overrides,
    });
  }
  function download(
    id: string,
    session: Session = actors.member,
    header?: string,
  ) {
    return createFileDownloads({
      database: database.db,
      storage,
      requireSession: async () => session,
      now: () => chatNow,
      limiter: createMemoryRateLimiter(() => chatNow.getTime()),
    }).getFile(
      new Request(`https://floor.test/api/files/${id}`, {
        headers: header ? { "If-None-Match": header } : undefined,
      }),
      id,
    );
  }
  async function attachment(
    overrides: Partial<typeof messageAttachments.$inferInsert> = {},
  ) {
    const id = crypto.randomUUID();
    const [row] = await database.db
      .insert(messageAttachments)
      .values({
        id,
        roomId: actors.roomId,
        uploaderId: actors.member.userId,
        storageKey: `chat/2026/10/${id}`,
        name: "가상 자료.pdf",
        size: 5,
        kind: "file",
        contentType: "application/pdf",
        createdAt: chatNow,
        uploadedAt: chatNow,
        ...overrides,
      })
      .returning();
    return row!;
  }
  async function attached({
    roomId = actors.roomId,
    author = actors.member,
    seq = 1,
    ...overrides
  }: Partial<typeof messageAttachments.$inferInsert> & {
    author?: Session;
    seq?: number;
  } = {}) {
    const [message] = await database.db
      .insert(messages)
      .values({
        roomId,
        authorId: author.userId,
        body: `가상 메시지 ${seq}`,
        seq,
        createdAt: new Date(chatNow.getTime() - seq * 60_000),
      })
      .returning();
    const file = await attachment({
      roomId,
      uploaderId: author.userId,
      messageId: message!.id,
      position: 0,
      ...overrides,
    });
    return { file, message: message! };
  }
  async function group(status: "active" | "left" = "active") {
    const [room] = await database.db
      .insert(chatRooms)
      .values({ kind: "group_dm", name: "가상 그룹" })
      .returning();
    await database.db.insert(chatRoomMembers).values(
      [actors.member, actors.admin].map((actor) => ({
        roomId: room!.id,
        userId: actor.userId,
        status: actor === actors.member ? status : ("active" as const),
        joinedAt: chatNow,
        statusChangedAt: chatNow,
      })),
    );
    return room!;
  }

  it("returns safe attachment fields, message send time, and blocked authors without storing client URLs", async () => {
    const { file, message } = await attached({
      author: actors.admin,
      createdAt: new Date(chatNow.getTime() - 86_400_000),
    });
    await database.db.insert(userBlocks).values({
      blockerId: actors.member.userId,
      blockedId: actors.admin.userId,
      createdAt: chatNow,
    });
    expect(await queries().getRoomFiles(actors.roomId, {})).toEqual({
      files: [
        {
          id: file.id,
          name: file.name,
          size: 5,
          kind: "file",
          width: null,
          height: null,
          uploaderName: actors.admin.name,
          sentAt: message.createdAt.toISOString(),
          messageId: message.id,
          seq: 1,
        },
      ],
      hasMore: false,
      nextCursor: null,
    });
    const page = await queries().getRoomFiles(actors.roomId, {});
    expect(JSON.stringify(page)).not.toContain("@");
    expect(JSON.stringify(page)).not.toContain("storageKey");
    expect(JSON.stringify(page)).not.toContain("position");
    expect((await download(file.id)).status).toBe(200);
  });
  it("excludes pending, unattached and deleted-message files and applies the kind filter", async () => {
    const image = await attached({
      seq: 1,
      kind: "image",
      width: 20,
      height: 10,
      contentType: "image/png",
    });
    const ordinary = await attached({ seq: 2 });
    const deleted = await attached({ seq: 3 });
    await database.db
      .update(messages)
      .set({ deletedAt: chatNow, body: "" })
      .where(eq(messages.id, deleted.message.id));
    await attachment();
    await attachment({ uploadedAt: null });
    const all = await queries().getRoomFiles(actors.roomId, { kind: "all" });
    expect(all.files.map(({ id }) => id)).toEqual([
      ordinary.file.id,
      image.file.id,
    ]);
    expect(
      (
        await queries().getRoomFiles(actors.roomId, { kind: "image" })
      ).files.map(({ id }) => id),
    ).toEqual([image.file.id]);
    expect(
      (await queries().getRoomFiles(actors.roomId, { kind: "file" })).files.map(
        ({ id }) => id,
      ),
    ).toEqual([ordinary.file.id]);
    expect((await download(deleted.file.id, actors.member, "*")).status).toBe(
      404,
    );
  });
  it("paginates by sequence and position without dropping or repeating attachments within one message", async () => {
    const expected: { id: string; seq: number; position: number }[] = [];
    for (let seq = 1; seq <= 5; seq++) {
      const { file, message } = await attached({ seq, position: 0 });
      expected.push({ id: file.id, seq, position: 0 });
      for (let position = 1; position < (seq === 5 ? 7 : 9); position++) {
        const extra = await attachment({
          messageId: message.id,
          position,
          createdAt: new Date(chatNow.getTime() + position * 6000),
        });
        expected.push({ id: extra.id, seq, position });
      }
    }
    expected.sort((a, b) => b.seq - a.seq || b.position - a.position);
    const first = await queries().getRoomFiles(actors.roomId, {});
    expect(first.files).toHaveLength(30);
    expect(first.hasMore).toBe(true);
    expect(first.nextCursor).toBe(
      `${expected[29]!.seq}_${expected[29]!.position}`,
    );
    const second = await queries().getRoomFiles(actors.roomId, {
      before: first.nextCursor,
    });
    expect(second.hasMore).toBe(false);
    expect(second.nextCursor).toBeNull();
    expect([...first.files, ...second.files].map(({ id }) => id)).toEqual(
      expected.map(({ id }) => id),
    );
    expect(
      new Set([...first.files, ...second.files].map(({ id }) => id)).size,
    ).toBe(43);
  });
  it("has no next cursor for exactly thirty results", async () => {
    for (let seq = 1; seq <= 3; seq++) {
      const { message } = await attached({ seq });
      for (let position = 1; position < 10; position++)
        await attachment({ messageId: message.id, position });
    }
    const page = await queries().getRoomFiles(actors.roomId, {});
    expect(page.files).toHaveLength(30);
    expect(page.hasMore).toBe(false);
    expect(page.nextCursor).toBeNull();
  });
  it("does not read foreign attachment metadata even while the authorization query is parallel", async () => {
    const { file } = await attached({ name: "비공개 자료 이름" });
    for (const session of [actors.outsider, actors.operator]) {
      expect(
        await fileDal.listRoomFiles(
          actors.roomId,
          session.userId,
          { kind: "all" },
          database.db,
        ),
      ).toEqual([]);
      expect(
        await fileDal.readDownloadAttachment(
          file.id,
          session.userId,
          new Date(0),
          database.db,
        ),
      ).toBeNull();
      await expect(
        queries(session).getRoomFiles(actors.roomId, {}),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect((await download(file.id, session, "*")).status).toBe(404);
    }
    expect(storage.stat).not.toHaveBeenCalled();
  });
  it("revokes download and list access after team removal or space deletion", async () => {
    const { file } = await attached();
    await database.db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.userId, actors.member.userId),
          eq(teamMembers.teamId, actors.teamId),
        ),
      );
    expect((await download(file.id)).status).toBe(404);
    await expect(
      queries().getRoomFiles(actors.roomId, {}),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await database.db
      .update(chatSpaces)
      .set({ deletedAt: chatNow })
      .where(eq(chatSpaces.id, actors.spaceId));
    expect((await download(file.id, actors.admin, "*")).status).toBe(404);
    await expect(
      queries(actors.admin).getRoomFiles(actors.roomId, {}),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("does not allow former group members to download or list files", async () => {
    const room = await group();
    const { file } = await attached({ roomId: room.id });
    expect((await download(file.id)).status).toBe(200);
    await database.db
      .update(chatRoomMembers)
      .set({ status: "left" })
      .where(
        and(
          eq(chatRoomMembers.roomId, room.id),
          eq(chatRoomMembers.userId, actors.member.userId),
        ),
      );
    expect((await download(file.id, actors.member, "*")).status).toBe(404);
    await expect(queries().getRoomFiles(room.id, {})).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("uses the same readable-room condition for voice, archived text and accepted direct rooms", async () => {
    const [voice] = await database.db
      .insert(chatRooms)
      .values({
        kind: "voice",
        spaceId: actors.spaceId,
        name: "자료 음성방",
        voiceCapacity: 10,
      })
      .returning();
    const pair = [actors.member.userId, actors.admin.userId].sort();
    const [direct] = await database.db
      .insert(chatRooms)
      .values({ kind: "dm", dmLowUserId: pair[0], dmHighUserId: pair[1] })
      .returning();
    await database.db
      .insert(chatRoomMembers)
      .values(
        [actors.member, actors.admin].map(({ userId }) => ({
          roomId: direct!.id,
          userId,
          status: "active" as const,
          joinedAt: chatNow,
          statusChangedAt: chatNow,
        })),
      );
    await database.db
      .update(chatRooms)
      .set({ archivedAt: chatNow })
      .where(eq(chatRooms.id, actors.roomId));
    for (const roomId of [voice!.id, actors.roomId, direct!.id]) {
      const { file } = await attached({ roomId });
      expect(
        (await queries().getRoomFiles(roomId, {})).files.map(({ id }) => id),
      ).toEqual([file.id]);
      expect((await download(file.id, actors.member, "*")).status).toBe(304);
      expect((await download(file.id, actors.outsider, "*")).status).toBe(404);
    }
  });
  it("reads ended and cancelled meeting files only while booking membership remains", async () => {
    const [branch] = await database.db
      .insert(branches)
      .values({ name: "가상 회의 지점" })
      .returning();
    const [floor] = await database.db
      .insert(floors)
      .values({ branchId: branch!.id, name: "1F", level: 1 })
      .returning();
    const [space] = await database.db
      .insert(spaces)
      .values({ floorId: floor!.id, name: "가상 회의실", type: "meeting_room" })
      .returning();
    const [booking] = await database.db
      .insert(bookings)
      .values({
        spaceId: space!.id,
        userId: actors.admin.userId,
        during: {
          start: new Date(chatNow.getTime() - 172_800_000),
          end: new Date(chatNow.getTime() - 169_200_000),
        },
      })
      .returning();
    await database.db
      .insert(bookingParticipants)
      .values({ bookingId: booking!.id, userId: actors.member.userId });
    const [room] = await database.db
      .insert(chatRooms)
      .values({ kind: "meeting", bookingId: booking!.id })
      .returning();
    const { file } = await attached({ roomId: room!.id });
    expect((await download(file.id)).status).toBe(200);
    expect((await queries().getRoomFiles(room!.id, {})).files).toHaveLength(1);
    await database.db
      .update(bookings)
      .set({
        status: "cancelled",
        cancelledAt: chatNow,
        cancelledBy: actors.admin.userId,
      })
      .where(eq(bookings.id, booking!.id));
    expect((await download(file.id)).status).toBe(200);
    await database.db
      .delete(bookingParticipants)
      .where(eq(bookingParticipants.bookingId, booking!.id));
    expect((await download(file.id)).status).toBe(404);
    expect((await download(file.id, actors.admin)).status).toBe(200);
  });
  it("allows only the uploader to preview a completed, unexpired unattached upload", async () => {
    const file = await attachment();
    expect((await download(file.id)).status).toBe(200);
    expect((await download(file.id, actors.admin)).status).toBe(404);
    for (const overrides of [
      { uploadedAt: null },
      { createdAt: new Date(chatNow.getTime() - UPLOAD_LIFETIME_MS) },
      { createdAt: new Date(chatNow.getTime() - UPLOAD_LIFETIME_MS - 1) },
    ]) {
      const pending = await attachment(overrides);
      expect((await download(pending.id)).status).toBe(404);
    }
    const edge = await attachment({
      createdAt: new Date(chatNow.getTime() - UPLOAD_LIFETIME_MS + 1),
    });
    expect((await download(edge.id)).status).toBe(200);
  });
  it("does not impose the pending lifetime on attachments already sent", async () => {
    const { file } = await attached({
      createdAt: new Date(chatNow.getTime() - 30 * 86_400_000),
    });
    expect((await download(file.id)).status).toBe(200);
  });
  it("does not trust attachment room metadata that mismatches its message", async () => {
    const { message } = await attached({
      roomId: actors.otherSpace.roomId,
      author: actors.outsider,
    });
    const wrong = await attachment({ messageId: message.id, position: 1 });
    expect((await download(wrong.id)).status).toBe(404);
    expect(
      (await queries().getRoomFiles(actors.roomId, {})).files,
    ).toHaveLength(0);
  });
  it("keeps lists readable when the byte store is disabled", async () => {
    const { file } = await attached();
    storage = { ...storage, kind: "disabled" };
    expect((await download(file.id)).status).toBe(404);
    expect(
      (await queries().getRoomFiles(actors.roomId, {})).files,
    ).toHaveLength(1);
  });
  it("requires a session before invalid query, then validates before rate and checks access last", async () => {
    const read = vi.spyOn(fileDal, "listRoomFiles");
    const consume = vi.fn(() => ({ allowed: false as const, retryAfter: 9 }));
    await expect(
      queries(actors.member, {
        requireSession: async () => {
          throw new ActionError("UNAUTHENTICATED");
        },
        limiter: { consume },
      }).getRoomFiles("bad", { kind: "bad" }),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    await expect(
      queries(actors.member, { limiter: { consume } }).getRoomFiles("bad", {
        kind: "bad",
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(consume).not.toHaveBeenCalled();
    await expect(
      queries(actors.member, { limiter: { consume } }).getRoomFiles("bad", {}),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(read).not.toHaveBeenCalled();
    await expect(queries().getRoomFiles("bad", {})).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(read).not.toHaveBeenCalled();
  });
  it("applies a per-user sixty-page limit and renews it after sixty seconds", async () => {
    let instant = chatNow.getTime();
    const limiter = createMemoryRateLimiter(() => instant);
    const reader = queries(actors.member, { limiter });
    for (let i = 0; i < 60; i++) await reader.getRoomFiles(actors.roomId, {});
    await expect(reader.getRoomFiles(actors.roomId, {})).rejects.toMatchObject({
      retryAfter: 60,
    });
    await expect(
      queries(actors.admin, { limiter }).getRoomFiles(actors.roomId, {}),
    ).resolves.toMatchObject({ files: [] });
    instant += 60_000;
    await expect(reader.getRoomFiles(actors.roomId, {})).resolves.toMatchObject(
      { files: [] },
    );
  });
  it("keeps a one-stage two-SQL budget independent of room/file count and returns at most thirty", async () => {
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      expect(
        (await queries().getRoomFiles(actors.roomId, {})).files,
      ).toHaveLength(0);
      expect(meter.stop().perStage).toEqual([2]);
      for (let seq = 1; seq <= 35; seq++) await attached({ seq });
      await database.db.insert(chatRooms).values(
        Array.from({ length: 20 }, (_, i) => ({
          kind: "text" as const,
          spaceId: actors.spaceId,
          name: `추가방 ${i}`,
        })),
      );
      meter.start();
      const page = await queries().getRoomFiles(actors.roomId, {});
      expect(page.files).toHaveLength(30);
      expect(meter.stop().perStage).toEqual([2]);
      meter.start();
      await queries().getRoomFiles(actors.roomId, { before: page.nextCursor });
      expect(meter.stop().perStage).toEqual([2]);
    } finally {
      meter.restore();
    }
  });
});
