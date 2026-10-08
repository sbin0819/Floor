import { eq, sql } from "drizzle-orm";
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
import { createChatUploads } from "@/features/chat/uploads";
import {
  MAX_STORAGE_BYTES,
  MAX_UPLOAD_BYTES,
  UPLOAD_LIFETIME_MS,
} from "@/features/chat/upload-types";
import * as access from "@/lib/dal/chat-access";
import { totalUploadBytes } from "@/lib/dal/chat-uploads";
import * as uploadDal from "@/lib/dal/chat-uploads";
import * as attachmentDal from "@/lib/dal/chat-attachments";
import { chatRooms, messageAttachments, messages } from "@/lib/db/schema";
import * as schema from "@/lib/db/schema";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import { noopRealtime } from "@/lib/realtime/noop";
import type { FileStorage } from "@/lib/storage/types";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("attachment quota expiry audit", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  const statements: string[] = [];
  beforeAll(async () => {
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(query) {
          statements.push(query);
        },
      },
    });
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await database.db.execute(sql`truncate users, branches cascade`);
    actors = await seedChatActors(database);
    statements.length = 0;
  });
  const storage: FileStorage = {
    kind: "local",
    createUploadTarget: async () => ({
      url: "/test-upload",
      method: "PUT",
      headers: {},
    }),
    readHead: async () => new Uint8Array(),
    stat: async () => null,
    readStream: async () => null,
    remove: async () => {},
  };

  it("does not attach an expired reservation using an older request timestamp after a newer allocation excluded it from quota", async () => {
    const cutoff = new Date(chatNow.getTime() - UPLOAD_LIFETIME_MS);
    for (let seq = 1; seq <= 4; seq++) {
      const [message] = await database.db
        .insert(messages)
        .values({
          roomId: actors.secondRoomId,
          authorId: actors.member.userId,
          seq,
          body: "기존 자료",
        })
        .returning();
      await database.db.insert(messageAttachments).values(
        Array.from({ length: 10 }, (_, position) => ({
          roomId: actors.secondRoomId,
          uploaderId: actors.member.userId,
          messageId: message!.id,
          position,
          storageKey: `existing-${seq}-${position}`,
          name: "기존.txt",
          size: MAX_UPLOAD_BYTES,
          contentType: "application/octet-stream",
          uploadedAt: cutoff,
          createdAt: cutoff,
        })),
      );
    }
    await database.db.insert(messageAttachments).values(
      Array.from({ length: 20 }, (_, index) => ({
        roomId: actors.secondRoomId,
        uploaderId: actors.member.userId,
        storageKey: `old-${index}`,
        name: "만료.txt",
        size: 1,
        contentType: "application/octet-stream",
        createdAt: new Date(cutoff.getTime() - 1000),
      })),
    );
    const [late] = await database.db
      .insert(messageAttachments)
      .values({
        roomId: actors.roomId,
        uploaderId: actors.member.userId,
        storageKey: "latest-expired",
        name: "마지막.txt",
        size: MAX_UPLOAD_BYTES,
        contentType: "application/octet-stream",
        uploadedAt: cutoff,
        createdAt: new Date(cutoff.getTime() - 1),
      })
      .returning();
    let entered!: () => void;
    let resume!: () => void;
    const enteredPromise = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const release = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const original = access.canWriteRoom;
    let paused = false;
    vi.spyOn(access, "canWriteRoom").mockImplementation(async (...args) => {
      const result = await original(...args);
      if (args[1] === actors.roomId && !paused) {
        paused = true;
        entered();
        await release;
      }
      return result;
    });
    const oldSend = createChatActions({
      database: database.db,
      getSession: async () => actors.member,
      now: () => new Date(chatNow.getTime() - 2),
      limiter: createMemoryRateLimiter(),
      publisher: noopRealtime,
      storage,
      logError: vi.fn(),
    }).sendMessage({
      roomId: actors.roomId,
      clientId: crypto.randomUUID(),
      body: "",
      attachmentIds: [late!.id],
    });
    await enteredPromise;
    const newlyReserved = await createChatUploads({
      database: database.db,
      getSession: async () => actors.member,
      now: () => chatNow,
      storage,
      limiter: createMemoryRateLimiter(),
    }).createUploads({
      roomId: actors.secondRoomId,
      files: [{ name: "신규.txt", size: 24 * 1024 * 1024 }],
    });
    expect(newlyReserved.ok).toBe(true);
    resume();
    const result = await oldSend;
    const total = await totalUploadBytes(
      actors.member.userId,
      cutoff,
      database.db,
    );
    expect({ accepted: result.ok, total }).toEqual({
      accepted: false,
      total: MAX_STORAGE_BYTES,
    });
    expect(result).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "storage_quota",
    });
    expect(
      await database.db
        .select({ id: messages.id })
        .from(messages)
        .where(eq(messages.roomId, actors.roomId)),
    ).toEqual([]);
    const [retained] = await database.db
      .select()
      .from(messageAttachments)
      .where(eq(messageAttachments.id, late!.id));
    expect(retained?.messageId).toBeNull();
  });

  it("serializes attaching with quota allocation without changing the remaining lock order or clientId retry priority", async () => {
    const [file] = await database.db
      .insert(messageAttachments)
      .values({
        roomId: actors.roomId,
        uploaderId: actors.member.userId,
        storageKey: "ready",
        name: "정상.txt",
        size: 1,
        contentType: "application/octet-stream",
        createdAt: chatNow,
        uploadedAt: chatNow,
      })
      .returning();
    const publishMany = vi.fn(async () => {});
    const actions = createChatActions({
      database: database.db,
      getSession: async () => actors.member,
      now: () => chatNow,
      limiter: createMemoryRateLimiter(),
      publisher: { ...noopRealtime, publishMany },
      storage,
    });
    statements.length = 0;
    const input = {
      roomId: actors.roomId,
      clientId: crypto.randomUUID(),
      body: "",
      attachmentIds: [file!.id],
    };
    const first = await actions.sendMessage(input);
    expect(first.ok).toBe(true);
    const locks = statements.filter((query) =>
      /for (?:key share|update|no key update)/i.test(query),
    );
    expect(locks).toHaveLength(5);
    expect(locks[0]).toMatch(/from "users" .*for update$/i);
    expect(locks[1]).toMatch(/from "chat_spaces" .*for key share$/i);
    expect(locks[2]).toMatch(/from "chat_rooms" .*for update$/i);
    expect(locks[3]).toMatch(/from "message_attachments" .*for update$/i);
    expect(locks[4]).toContain('insert into "chat_room_reads"');
    const quota = vi
      .spyOn(uploadDal, "totalUploadBytes")
      .mockRejectedValue(new Error("Must not recount an existing clientId."));
    const attachments = vi
      .spyOn(attachmentDal, "lockMessageAttachments")
      .mockRejectedValue(
        new Error("Must not validate replacement attachments on retry."),
      );
    expect(
      await actions.sendMessage({
        ...input,
        body: "바뀐 본문",
        attachmentIds: [crypto.randomUUID()],
      }),
    ).toEqual(first);
    expect(quota).not.toHaveBeenCalled();
    expect(attachments).not.toHaveBeenCalled();
    expect(publishMany).toHaveBeenCalledTimes(1);
    expect(
      await database.db
        .select({ lastSeq: chatRooms.lastSeq })
        .from(chatRooms)
        .where(eq(chatRooms.id, actors.roomId)),
    ).toEqual([{ lastSeq: 1 }]);
  });
});
