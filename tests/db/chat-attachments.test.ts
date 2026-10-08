import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, asc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
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
import {
  createChatActions,
  type ChatActionDependencies,
} from "@/features/chat/action-factory";
import { createChatQueries } from "@/features/chat/query-factory";
import * as directFlow from "@/features/chat/direct-request-flow";
import * as attachmentDal from "@/lib/dal/chat-attachments";
import * as messageWrites from "@/lib/dal/chat-message-write";
import {
  createEmptyDirectRoom,
  initializeDirectMembers,
} from "@/lib/dal/direct-requests";
import * as schema from "@/lib/db/schema";
import {
  chatRoomMembers,
  chatRooms,
  messageAttachments,
  messages,
  users,
} from "@/lib/db/schema";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import { roomChannel, userChannel } from "@/lib/realtime/channels";
import type { RealtimeItem, RealtimePublisher } from "@/lib/realtime/types";
import { createLocalFileStorage } from "@/lib/storage/local";
import type { LocalFileStorage } from "@/lib/storage/types";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("message attachments through real actions and migrations", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  let directory: string;
  let storage: LocalFileStorage;
  const events: RealtimeItem[] = [];
  const statements: string[] = [];
  const logError = vi.fn();
  const publisher: RealtimePublisher = {
    async publish(channel, event) {
      events.push({ channel, event });
    },
    async publishMany(items) {
      events.push(...items);
    },
  };
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), "floor-chat-attachments-"));
    storage = createLocalFileStorage({ directory });
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema,
      logger: { logQuery: (text) => statements.push(text) },
    });
  });
  afterAll(async () => {
    await database?.client.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    vi.restoreAllMocks();
    logError.mockReset();
    await database.db.execute(sql`truncate users, branches cascade`);
    actors = await seedChatActors(database);
    await database.db.update(users).set({ emailVerified: true });
    events.length = 0;
    statements.length = 0;
  });
  const actions = (
    session = actors.member,
    extra: ChatActionDependencies = {},
  ) =>
    createChatActions({
      database: database.db,
      getSession: async () => session,
      now: () => chatNow,
      limiter: createMemoryRateLimiter(() => chatNow.getTime()),
      publisher,
      storage,
      logError,
      ...extra,
    });
  const queries = (session = actors.member) =>
    createChatQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => chatNow,
      limiter: createMemoryRateLimiter(() => chatNow.getTime()),
    });
  async function upload(
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
        name: "가상 자료.txt",
        size: 4,
        contentType: "application/octet-stream",
        uploadedAt: chatNow,
        createdAt: new Date(chatNow.getTime() - 1000),
        ...overrides,
      })
      .returning();
    await storage.writeStream(
      row!.storageKey,
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("file"));
          controller.close();
        },
      }),
      4,
    );
    return row!;
  }
  const input = (
    attachmentIds: string[] = [],
    body = "",
    roomId = actors.roomId,
  ) => ({
    roomId,
    clientId: crypto.randomUUID(),
    body,
    attachmentIds,
  });
  async function sent(
    attachmentIds: string[] = [],
    body = "",
    roomId = actors.roomId,
  ) {
    const result = await actions().sendMessage(
      input(attachmentIds, body, roomId),
    );
    if (!result.ok) throw new Error(`Unexpected send failure ${result.code}`);
    return result.data;
  }
  const attachments = () =>
    database.db
      .select()
      .from(messageAttachments)
      .orderBy(asc(messageAttachments.id));
  const room = async (id = actors.roomId) =>
    (
      await database.db.select().from(chatRooms).where(eq(chatRooms.id, id))
    )[0]!;
  async function direct(requested: boolean) {
    return database.db.transaction(async (tx) => {
      const created = await createEmptyDirectRoom(
        actors.member.userId,
        actors.outsider.userId,
        chatNow,
        tx,
      );
      await initializeDirectMembers(
        {
          roomId: created.roomId,
          senderId: actors.member.userId,
          recipientId: actors.outsider.userId,
          requested,
          now: new Date(chatNow.getTime() - 1000),
        },
        tx,
      );
      return created.roomId;
    });
  }

  it("sends files without body and with trimmed body, preserves requested order and deduplicates IDs", async () => {
    const file = await upload();
    const image = await upload({
      kind: "image",
      name: "사진.png",
      contentType: "image/png",
      width: 640,
      height: 480,
    });
    const saved = await sent([image.id, file.id, image.id]);
    expect(saved.body).toBe("");
    expect(saved.attachments).toEqual([
      {
        id: image.id,
        name: image.name,
        size: 4,
        kind: "image",
        width: 640,
        height: 480,
      },
      {
        id: file.id,
        name: file.name,
        size: 4,
        kind: "file",
        width: null,
        height: null,
      },
    ]);
    expect(
      (await attachments()).map(({ id, messageId, position }) => ({
        id,
        messageId,
        position,
      })),
    ).toEqual(
      expect.arrayContaining([
        { id: image.id, messageId: saved.id, position: 0 },
        { id: file.id, messageId: saved.id, position: 1 },
      ]),
    );
    const another = await upload();
    expect(await sent([another.id], "  파일을 확인해 주세요  ")).toMatchObject({
      body: "파일을 확인해 주세요",
      attachments: [{ id: another.id }],
    });
  });

  it("accepts ten attachments and rejects eleven or empty body plus empty attachments before any writes", async () => {
    const files = await Promise.all(Array.from({ length: 11 }, () => upload()));
    for (const invalid of [
      input(files.map(({ id }) => id)),
      input([], " \n "),
    ]) {
      const before = await attachments();
      statements.length = 0;
      expect(await actions().sendMessage(invalid)).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
      expect(
        statements.some((text) => /^(insert|update|delete)\b/iu.test(text)),
      ).toBe(false);
      expect(await attachments()).toEqual(before);
    }
    const saved = await sent(files.slice(0, 10).map(({ id }) => id));
    expect(saved.attachments).toHaveLength(10);
    expect(
      (await attachments()).find(({ id }) => id === files[10]!.id)?.messageId,
    ).toBeNull();
  });

  it.each([
    "other uploader",
    "other room",
    "not uploaded",
    "already attached",
    "expired",
    "boundary",
    "missing",
  ] as const)(
    "rejects %s atomically with a fixed attachment error",
    async (kind) => {
      const valid = await upload();
      const invalid = await upload({
        ...(kind === "other uploader"
          ? { uploaderId: actors.admin.userId }
          : {}),
        ...(kind === "other room" ? { roomId: actors.secondRoomId } : {}),
        ...(kind === "not uploaded" ? { uploadedAt: null } : {}),
        ...(kind === "expired" || kind === "boundary"
          ? {
              createdAt: new Date(
                chatNow.getTime() - 86400000 - (kind === "expired" ? 1 : 0),
              ),
            }
          : {}),
      });
      if (kind === "already attached") await sent([invalid.id]);
      const before = await attachments();
      const beforeMessages = await database.db.select().from(messages);
      const beforeRoom = await room();
      events.length = 0;
      expect(
        await actions().sendMessage(
          input([
            valid.id,
            kind === "missing" ? crypto.randomUUID() : invalid.id,
          ]),
        ),
      ).toEqual({
        ok: false,
        code: "INVALID_INPUT",
        fieldErrors: { attachmentIds: ["unavailable"] },
      });
      expect(await attachments()).toEqual(before);
      expect(await database.db.select().from(messages)).toEqual(beforeMessages);
      expect(await room()).toEqual(beforeRoom);
      expect(events).toEqual([]);
      expect(logError).not.toHaveBeenCalled();
    },
  );

  it("accepts the last millisecond before upload expiry", async () => {
    const file = await upload({
      createdAt: new Date(chatNow.getTime() - 86400000 + 1),
    });
    expect((await sent([file.id])).attachments[0]?.id).toBe(file.id);
  });

  it("returns an existing clientId result without rechecking or attaching files again", async () => {
    const file = await upload();
    const request = input([file.id]);
    const original = await actions().sendMessage(request);
    expect(original.ok).toBe(true);
    const before = await attachments();
    const lock = vi.spyOn(attachmentDal, "lockMessageAttachments");
    events.length = 0;
    expect(await actions().sendMessage(request)).toEqual(original);
    expect(lock).not.toHaveBeenCalled();
    expect(await attachments()).toEqual(before);
    expect(await database.db.select().from(messages)).toHaveLength(1);
    expect(events).toEqual([]);
  });

  it("requires both DM members active before request promotion or any attachment changes", async () => {
    const roomId = await direct(true);
    const before = await database.db.select().from(chatRoomMembers);
    const prepare = vi.spyOn(directFlow, "prepareDirectSend");
    for (const session of [actors.member, actors.outsider]) {
      const file = await upload({ roomId, uploaderId: session.userId });
      expect(
        await actions(session).sendMessage(input([file.id], "파일", roomId)),
      ).toEqual({ ok: false, code: "FORBIDDEN" });
    }
    expect(prepare).not.toHaveBeenCalled();
    expect(await database.db.select().from(chatRoomMembers)).toEqual(before);
    expect(await database.db.select().from(messages)).toEqual([]);
    await database.db
      .update(chatRoomMembers)
      .set({ status: "active", requestedAt: null })
      .where(
        and(
          eq(chatRoomMembers.roomId, roomId),
          eq(chatRoomMembers.userId, actors.outsider.userId),
        ),
      );
    const file = await upload({ roomId });
    const saved = await sent([file.id], "", roomId);
    expect(saved.attachments[0]?.id).toBe(file.id);
    expect(events).toContainEqual(
      expect.objectContaining({
        channel: userChannel(actors.outsider.userId),
        event: expect.objectContaining({
          type: "room.activity",
          preview: {
            messageId: saved.id,
            authorName: actors.member.name,
            excerpt: `파일: ${file.name}`,
          },
        }),
      }),
    );
  });

  it("rejects attachment fields on the first message-request endpoint", async () => {
    const file = await upload();
    statements.length = 0;
    expect(
      await actions().sendMessageRequest({
        userId: actors.outsider.userId,
        clientId: crypto.randomUUID(),
        body: "요청",
        attachmentIds: [file.id],
      }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(
      statements.some((text) => /^(insert|update|delete)\b/iu.test(text)),
    ).toBe(false);
    expect(events).toEqual([]);
  });

  it("allows editing attached text to empty without changing files, but not a bare message", async () => {
    const file = await upload();
    const attached = await sent([file.id], "지울 본문");
    const before = await attachments();
    expect(
      await actions().editMessage({ messageId: attached.id, body: "  " }),
    ).toMatchObject({
      ok: true,
      data: { body: "", attachments: attached.attachments },
    });
    expect(await attachments()).toEqual(before);
    const bare = await sent([], "글만 있어요");
    expect(
      await actions().editMessage({ messageId: bare.id, body: "" }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    const rows = (
      await queries().getRoomMessagesPage(actors.roomId, { after: "0" })
    ).messages;
    expect(rows.find(({ id }) => id === bare.id)?.body).toBe("글만 있어요");
  });

  it("rolls the sequence, inserted message and attachment links back on a later failure", async () => {
    const file = await upload();
    const before = await attachments();
    const original = attachmentDal.attachMessageFiles;
    vi.spyOn(attachmentDal, "attachMessageFiles").mockImplementationOnce(
      async (...args) => {
        await original(...args);
        throw new Error(
          "private attachment-key and filename must not be logged",
        );
      },
    );
    expect(await actions().sendMessage(input([file.id]))).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(await attachments()).toEqual(before);
    expect(await database.db.select().from(messages)).toEqual([]);
    expect((await room()).lastSeq).toBe(0);
    expect(await storage.stat(file.storageKey)).toEqual({ size: 4 });
    expect(events).toEqual([]);
    expect(JSON.stringify(logError.mock.calls)).not.toContain("private");
  });

  it("deletes attachment rows in the transaction and objects after commit, once only", async () => {
    const file = await upload();
    const message = await sent([file.id]);
    const originalRemove = storage.remove.bind(storage);
    const remove = vi
      .spyOn(storage, "remove")
      .mockImplementation(async (key) => {
        expect(await attachments()).toEqual([]);
        expect(
          (
            await database.db
              .select()
              .from(messages)
              .where(eq(messages.id, message.id))
          )[0]?.deletedAt,
        ).toEqual(chatNow);
        await originalRemove(key);
      });
    events.length = 0;
    expect(await actions().deleteMessage({ messageId: message.id })).toEqual({
      ok: true,
      data: { id: message.id },
    });
    expect(remove).toHaveBeenCalledExactlyOnceWith(file.storageKey);
    expect(await storage.stat(file.storageKey)).toBeNull();
    expect(await actions().deleteMessage({ messageId: message.id })).toEqual({
      ok: true,
      data: { id: message.id },
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(
      events.filter(({ event }) => event.type === "message.deleted"),
    ).toHaveLength(1);
  });

  it("keeps attachment rows and objects when message deletion rolls back", async () => {
    const file = await upload();
    const message = await sent([file.id]);
    const before = await attachments();
    const original = attachmentDal.deleteMessageAttachments;
    vi.spyOn(attachmentDal, "deleteMessageAttachments").mockImplementationOnce(
      async (...args) => {
        await original(...args);
        throw new Error("private-object-path");
      },
    );
    const remove = vi.spyOn(storage, "remove");
    events.length = 0;
    expect(await actions().deleteMessage({ messageId: message.id })).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(await attachments()).toEqual(before);
    expect(await storage.stat(file.storageKey)).toEqual({ size: 4 });
    expect(remove).not.toHaveBeenCalled();
    expect(events).toEqual([]);
    expect(
      (
        await database.db
          .select()
          .from(messages)
          .where(eq(messages.id, message.id))
      )[0]?.deletedAt,
    ).toBeNull();
  });

  it("reports cleanup failure safely without undoing message deletion or publishing twice", async () => {
    const file = await upload();
    const message = await sent([file.id]);
    vi.spyOn(storage, "remove").mockRejectedValueOnce(
      new Error(`private-key=${file.storageKey}`),
    );
    events.length = 0;
    expect(await actions().deleteMessage({ messageId: message.id })).toEqual({
      ok: true,
      data: { id: message.id },
    });
    expect(await attachments()).toEqual([]);
    expect(await storage.stat(file.storageKey)).toEqual({ size: 4 });
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      "Chat attachment cleanup failed.",
    );
    expect(
      events.filter(({ event }) => event.type === "message.deleted"),
    ).toHaveLength(1);
  });

  it("does not clean objects on a failed conditional deletion", async () => {
    const file = await upload();
    const message = await sent([file.id]);
    const remove = vi.spyOn(storage, "remove");
    vi.spyOn(messageWrites, "deleteChatMessage").mockResolvedValueOnce(false);
    expect(await actions().deleteMessage({ messageId: message.id })).toEqual({
      ok: true,
      data: { id: message.id },
    });
    expect(remove).not.toHaveBeenCalled();
    expect(await attachments()).toHaveLength(1);
  });

  it("shares ordered attachment and reply summaries in action, page, channel and events within existing SQL budgets", async () => {
    const file = await upload({ name: "원본.pdf" });
    const image = await upload({
      kind: "image",
      width: 2,
      height: 3,
      name: "사진.jpg",
      contentType: "image/jpeg",
    });
    const original = await sent([file.id, image.id]);
    const result = await actions(actors.admin).sendMessage({
      ...input([], "확인했어요"),
      replyToId: original.id,
    });
    if (!result.ok) throw new Error("Expected a reply");
    const reply = result.data;
    expect(reply.replyTo).toEqual({
      id: original.id,
      authorName: actors.member.name,
      excerpt: "파일 2개",
      deleted: false,
      attachmentSummary: { images: 1, files: 1, firstName: file.name },
    });
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const page = await queries().getRoomMessagesPage(actors.roomId, {
        after: "0",
      });
      expect(meter.stop()).toEqual({ stages: 1, statements: 2, perStage: [2] });
      meter.start();
      const channel = await queries().getChannelView(
        actors.spaceId,
        actors.roomId,
      );
      expect(meter.stop()).toEqual({
        stages: 2,
        statements: 3,
        perStage: [1, 2],
      });
      expect(page.messages[0]?.attachments).toEqual(original.attachments);
      expect(channel?.messages[1]?.replyTo).toEqual(reply.replyTo);
      expect(events).toContainEqual({
        channel: roomChannel(actors.roomId),
        event: { type: "message.created", roomId: actors.roomId, ...original },
      });
      for (const serialized of [
        JSON.stringify(page),
        JSON.stringify(channel),
        JSON.stringify(events),
      ]) {
        expect(serialized).not.toContain(file.storageKey);
        expect(serialized).not.toContain(image.storageKey);
        expect(serialized).not.toContain(actors.member.email);
        expect(serialized).not.toContain("uploaderId");
        expect(serialized).not.toContain("contentType");
      }
      expect(
        await queries(actors.outsider).getChannelView(
          actors.spaceId,
          actors.roomId,
        ),
      ).toBeNull();
    } finally {
      meter.restore();
    }
    await actions().deleteMessage({ messageId: original.id });
    const page = await queries().getRoomMessagesPage(actors.roomId, {
      after: "0",
    });
    expect(page.messages[0]?.attachments).toEqual([]);
    expect(page.messages[1]?.replyTo).toEqual({
      id: original.id,
      authorName: actors.member.name,
      excerpt: "삭제된 메시지예요",
      deleted: true,
      attachmentSummary: null,
    });
  });
});
