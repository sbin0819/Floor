import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
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
  createChatUploads,
  type ChatUploadDependencies,
} from "@/features/chat/uploads";
import {
  MAX_STORAGE_BYTES,
  MAX_UPLOAD_BYTES,
  UPLOAD_LIFETIME_MS,
} from "@/features/chat/upload-types";
import type { Session } from "@/lib/auth/types";
import * as uploadDal from "@/lib/dal/chat-uploads";
import * as chatWrites from "@/lib/dal/chat-write";
import * as schema from "@/lib/db/schema";
import {
  messageAttachments,
  messages,
  chatRooms,
  chatRoomMembers,
  chatSpaces,
} from "@/lib/db/schema";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import { createLocalFileStorage } from "@/lib/storage/local";
import type { FileStorage, LocalFileStorage } from "@/lib/storage/types";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

const bytes = (text: string) => new TextEncoder().encode(text);
const stream = (body: Uint8Array) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(body);
      controller.close();
    },
  });
function png() {
  const value = new Uint8Array(33);
  value.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  new DataView(value.buffer).setUint32(16, 120);
  new DataView(value.buffer).setUint32(20, 80);
  value[24] = 8;
  value[25] = 2;
  return value;
}

describe("safe staged chat uploads", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  let directory: string;
  let store: LocalFileStorage;
  let instant: Date;
  let limiter: ReturnType<typeof createMemoryRateLimiter>;
  const logError = vi.fn();
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await database.db.execute(sql`truncate users, branches cascade`);
    actors = await seedChatActors(database);
    directory = await mkdtemp(join(tmpdir(), "floor-upload-test-"));
    store = createLocalFileStorage({
      directory: join(directory, "objects"),
      publicDirectory: join(directory, "public"),
    });
    instant = new Date(chatNow);
    limiter = createMemoryRateLimiter(() => instant.getTime());
  });
  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const feature = (
    session: Session | null = actors.member,
    extra: ChatUploadDependencies = {},
  ) =>
    createChatUploads({
      database: database.db,
      getSession: async () => session,
      storage: store,
      now: () => instant,
      limiter,
      logError,
      ...extra,
    });
  const create = (
    files = [{ name: "자료.txt", size: 3 }],
    roomId = actors.roomId,
  ) => feature().createUploads({ roomId, files });
  async function row(
    extra: Partial<typeof messageAttachments.$inferInsert> = {},
  ) {
    const id = crypto.randomUUID();
    const [value] = await database.db
      .insert(messageAttachments)
      .values({
        id,
        storageKey: `chat/2026/10/${id}`,
        uploaderId: actors.member.userId,
        roomId: actors.roomId,
        name: "자료.txt",
        size: 3,
        contentType: "application/octet-stream",
        createdAt: instant,
        ...extra,
      })
      .returning();
    return value!;
  }
  async function rows() {
    return database.db.select().from(messageAttachments);
  }
  async function putObject(
    value: Awaited<ReturnType<typeof row>>,
    body = bytes("abc"),
  ) {
    await store.writeStream(value.storageKey, stream(body), body.length);
  }
  async function attach(value: Awaited<ReturnType<typeof row>>) {
    const [message] = await database.db
      .insert(messages)
      .values({
        roomId: value.roomId,
        seq: 1,
        authorId: value.uploaderId,
        body: "첨부",
        createdAt: instant,
      })
      .returning();
    await database.db
      .update(messageAttachments)
      .set({ uploadedAt: instant, messageId: message!.id, position: 0 })
      .where(eq(messageAttachments.id, value.id));
  }
  function request(
    id: string,
    options: {
      body?: Uint8Array;
      length?: string | null;
      origin?: string | null;
    } = {},
  ) {
    const headers = new Headers();
    if (options.origin !== null)
      headers.set("Origin", options.origin ?? "https://floor.test");
    if (options.length !== null)
      headers.set("Content-Length", options.length ?? "3");
    const init: RequestInit & { duplex: "half" } = {
      method: "PUT",
      headers,
      body: stream(options.body ?? bytes("abc")),
      duplex: "half",
    };
    return new Request(`https://floor.test/api/uploads/${id}`, init);
  }
  const disabled = (): FileStorage => ({ ...store, kind: "disabled" });

  it("checks the session before input and storage", async () => {
    const value = disabled();
    const read = vi.spyOn(value, "stat");
    expect(await feature(null, { storage: value }).createUploads(null)).toEqual(
      { ok: false, code: "UNAUTHENTICATED" },
    );
    expect(await feature(null).completeUploads(null)).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(await feature(null).discardUploads(null)).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(read).not.toHaveBeenCalled();
    expect(await rows()).toEqual([]);
  });
  it("rejects disabled, unreadable, archived and admin-only rooms without reservations", async () => {
    const input = {
      roomId: actors.roomId,
      files: [{ name: "a.txt", size: 1 }],
    };
    expect(
      await feature(undefined, { storage: disabled() }).createUploads(input),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await feature(actors.outsider).createUploads(input)).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    await database.db
      .update(chatRooms)
      .set({ adminOnly: true })
      .where(eq(chatRooms.id, actors.roomId));
    expect(await feature().createUploads(input)).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    await database.db
      .update(chatRooms)
      .set({ adminOnly: false, archivedAt: instant })
      .where(eq(chatRooms.id, actors.roomId));
    expect(await feature().createUploads(input)).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await rows()).toEqual([]);
  });
  it.each(["requested", "declined"] as const)(
    "rejects %s DM uploads for either member without accepting the request",
    async (status) => {
      const [low, high] = [actors.member.userId, actors.outsider.userId].sort();
      const [room] = await database.db
        .insert(chatRooms)
        .values({ kind: "dm", dmLowUserId: low, dmHighUserId: high })
        .returning();
      await database.db.insert(chatRoomMembers).values([
        {
          roomId: room!.id,
          userId: actors.member.userId,
          status: "active",
          joinedAt: instant,
          statusChangedAt: instant,
        },
        {
          roomId: room!.id,
          userId: actors.outsider.userId,
          status,
          joinedAt: instant,
          statusChangedAt: instant,
          requestedAt: instant,
        },
      ]);
      const input = { roomId: room!.id, files: [{ name: "a.txt", size: 1 }] };
      expect(await feature().createUploads(input)).toEqual({
        ok: false,
        code: "FORBIDDEN",
      });
      expect((await feature(actors.outsider).createUploads(input)).ok).toBe(
        false,
      );
      expect(
        (
          await database.db
            .select()
            .from(chatRoomMembers)
            .where(eq(chatRoomMembers.userId, actors.outsider.userId))
        )[0]?.status,
      ).toBe(status);
      expect(await rows()).toEqual([]);
    },
  );
  it("normalizes names before blocking and returns indexed errors atomically", async () => {
    expect(
      await create([
        { name: "ok.txt", size: 1 },
        { name: "a.EXE. ", size: 1 },
      ]),
    ).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { "files.1.name": ["blocked_type"] },
    });
    expect(await rows()).toEqual([]);
    const result = await create([
      { name: " ../가/자료\u202e.txt. ", size: 1 },
    ]);
    expect(result.ok).toBe(true);
    const [saved] = await rows();
    expect(saved?.name).toBe("가자료.txt");
    expect(saved?.storageKey).toMatch(/^chat\/2026\/10\/[0-9a-f-]{36}$/);
    expect(saved?.storageKey).not.toContain("자료");
    if (result.ok)
      expect(Object.keys(result.data[0]!).sort()).toEqual([
        "attachmentId",
        "headers",
        "method",
        "uploadUrl",
      ]);
  });
  it.each([0, -1, MAX_UPLOAD_BYTES + 1, 1.5])(
    "rejects size %s before inserting anything",
    async (size) => {
      expect(await create([{ name: "a.txt", size }])).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
        fieldErrors: { "files.0.size": ["too_large"] },
      });
      expect(await rows()).toEqual([]);
    },
  );
  it("accepts the 25MB boundary and rejects empty or eleven-file batches", async () => {
    expect((await create([{ name: "a.txt", size: MAX_UPLOAD_BYTES }])).ok).toBe(
      true,
    );
    for (const files of [
      [],
      Array.from({ length: 11 }, () => ({ name: "a.txt", size: 1 })),
    ])
      expect(await create(files)).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
    expect(await rows()).toHaveLength(1);
  });
  it("limits upload starts to thirty per minute without a public reason", async () => {
    for (let index = 0; index < 30; index++)
      limiter.consume(`chat:upload:${actors.member.userId}`, 30, 60_000);
    expect(await create()).toEqual({ ok: false, code: "LIMIT_EXCEEDED" });
    expect(await rows()).toEqual([]);
    instant = new Date(instant.getTime() + 60_000);
    expect((await create()).ok).toBe(true);
  });
  it("counts attached, ready and uploading bytes but not expired reservations at the 1GB boundary", async () => {
    for (let index = 0; index < 40; index++)
      await row({
        size: MAX_UPLOAD_BYTES,
        uploadedAt: index % 2 ? instant : null,
      });
    const attached = await row({
      size: MAX_STORAGE_BYTES - 40 * MAX_UPLOAD_BYTES - 1,
      createdAt: new Date(instant.getTime() - 2 * UPLOAD_LIFETIME_MS),
    });
    await attach(attached);
    await row({
      size: MAX_UPLOAD_BYTES,
      createdAt: new Date(instant.getTime() - UPLOAD_LIFETIME_MS),
    });
    expect((await create([{ name: "last.txt", size: 1 }])).ok).toBe(true);
    expect(await create([{ name: "over.txt", size: 1 }])).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "storage_quota",
    });
    expect(
      await uploadDal.totalUploadBytes(
        actors.member.userId,
        new Date(instant.getTime() - UPLOAD_LIFETIME_MS),
        database.db,
      ),
    ).toBe(MAX_STORAGE_BYTES);
  });
  it("counts a competing reservation after acquiring the user lock", async () => {
    const original = uploadDal.lockUploadQuota;
    vi.spyOn(uploadDal, "lockUploadQuota").mockImplementationOnce(
      async (userId, tx) => {
        const locked = await original(userId, tx);
        await tx.insert(messageAttachments).values(
          Array.from({ length: 41 }, (_, index) => {
            const id = crypto.randomUUID();
            return {
              id,
              roomId: actors.roomId,
              uploaderId: userId,
              name: "other.txt",
              size:
                index === 40
                  ? MAX_STORAGE_BYTES - 40 * MAX_UPLOAD_BYTES
                  : MAX_UPLOAD_BYTES,
              storageKey: `chat/2026/10/${id}`,
              contentType: "application/octet-stream",
              createdAt: instant,
            };
          }),
        );
        return locked;
      },
    );
    expect(await create()).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "storage_quota",
    });
    expect(await rows()).toEqual([]);
  });
  it("rechecks space access after locking and uses the non-upgrading quota lock", async () => {
    const texts: string[] = [];
    const logged = drizzle({
      client: database.client,
      schema,
      logger: { logQuery: (query) => texts.push(query) },
    });
    const original = chatWrites.lockRoomForMessage;
    vi.spyOn(chatWrites, "lockRoomForMessage").mockImplementationOnce(
      async (roomId, tx) => {
        const locked = await original(roomId, tx);
        await tx
          .update(chatSpaces)
          .set({ deletedAt: instant })
          .where(eq(chatSpaces.id, actors.spaceId));
        return locked;
      },
    );
    expect(
      await feature(undefined, { database: logged }).createUploads({
        roomId: actors.roomId,
        files: [{ name: "자료.txt", size: 3 }],
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(await rows()).toEqual([]);
    const user = texts.findIndex(
      (text) => text.includes('"users"') && /for no key update/i.test(text),
    );
    const room = texts.findIndex(
      (text) => text.includes('"chat_rooms"') && /for update/i.test(text),
    );
    expect(user).toBeGreaterThanOrEqual(0);
    expect(room).toBeGreaterThan(user);
  });
  it("cleans only twenty expired own unattached rows after commit", async () => {
    const old = new Date(instant.getTime() - UPLOAD_LIFETIME_MS);
    const expired = await Promise.all(
      Array.from({ length: 22 }, () => row({ createdAt: old })),
    );
    for (const value of expired) await putObject(value);
    const other = await row({
      uploaderId: actors.admin.userId,
      createdAt: old,
    });
    await putObject(other);
    const attached = await row({ createdAt: old });
    await attach(attached);
    await putObject(attached);
    expect((await create()).ok).toBe(true);
    expect(
      (await rows()).filter(
        (value) => value.createdAt.getTime() === old.getTime(),
      ),
    ).toHaveLength(4);
    const stats = await Promise.all(
      expired.map((value) => store.stat(value.storageKey)),
    );
    expect(stats.filter(Boolean)).toHaveLength(2);
    expect(await store.stat(other.storageKey)).toEqual({ size: 3 });
    expect(await store.stat(attached.storageKey)).toEqual({ size: 3 });
  });
  it("rechecks unattached expiry in the DELETE itself, not only the candidate subquery", () => {
    const statement = uploadDal
      .removeExpiredUploads(
        actors.member.userId,
        new Date(instant.getTime() - UPLOAD_LIFETIME_MS),
        database.db,
      )
      .toSQL().sql;
    expect(statement).toMatch(
      /limit \$\d+\) and "message_attachments"\."uploader_id" = \$\d+ and "message_attachments"\."message_id" is null and "message_attachments"\."created_at" <= \$\d+/,
    );
  });
  it("rolls back cleanup on quota failure without deleting any object", async () => {
    const old = await row({
      createdAt: new Date(instant.getTime() - UPLOAD_LIFETIME_MS),
    });
    await putObject(old);
    vi.spyOn(uploadDal, "totalUploadBytes").mockResolvedValue(
      MAX_STORAGE_BYTES,
    );
    expect(await create()).toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(await rows()).toHaveLength(1);
    expect(await store.stat(old.storageKey)).toEqual({ size: 3 });
  });
  it("discards one committed batch when upload-target generation fails and logs no details", async () => {
    vi.spyOn(store, "createUploadTarget").mockRejectedValue(
      new Error("secret-path-token"),
    );
    const discard = vi.spyOn(uploadDal, "discardUnattachedUploads");
    expect(
      await create([
        { name: "a.txt", size: 1 },
        { name: "b.txt", size: 1 },
      ]),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(discard).toHaveBeenCalledTimes(1);
    expect(await rows()).toEqual([]);
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      "File upload request failed.",
    );
  });

  it("rejects anonymous and cross-origin PUT before looking up the row", async () => {
    const read = vi.spyOn(uploadDal, "readOwnedUploads");
    const id = crypto.randomUUID();
    expect((await feature(null).putUpload(request(id), id)).status).toBe(401);
    for (const origin of [null, "https://other.test", "null"])
      expect(
        (await feature().putUpload(request(id, { origin }), id)).status,
      ).toBe(403);
    expect(read).not.toHaveBeenCalled();
  });
  it("rejects disabled, malformed, absent, foreign, ready and expired PUT targets", async () => {
    const own = await row();
    expect(
      (
        await feature(undefined, { storage: disabled() }).putUpload(
          request(own.id),
          own.id,
        )
      ).status,
    ).toBe(404);
    for (const id of ["bad", crypto.randomUUID()])
      expect((await feature().putUpload(request(id), id)).status).toBe(404);
    for (const value of [
      await row({ uploaderId: actors.admin.userId }),
      await row({ uploadedAt: instant }),
      await row({
        createdAt: new Date(instant.getTime() - UPLOAD_LIFETIME_MS),
      }),
    ])
      expect(
        (await feature().putUpload(request(value.id), value.id)).status,
      ).toBe(404);
  });
  it.each([null, "2", "4", "3.0", "NaN"])(
    "rejects Content-Length %s without reading the body",
    async (length) => {
      const value = await row();
      const write = vi.spyOn(store, "writeStream");
      expect(
        (await feature().putUpload(request(value.id, { length }), value.id))
          .status,
      ).toBe(400);
      expect(write).not.toHaveBeenCalled();
    },
  );
  it.each(["ab", "abcd"])(
    "rejects an actual body of %s and leaves no object",
    async (body) => {
      const value = await row();
      expect(
        (
          await feature().putUpload(
            request(value.id, { body: bytes(body) }),
            value.id,
          )
        ).status,
      ).toBe(400);
      expect(await store.stat(value.storageKey)).toBeNull();
    },
  );
  it("publishes exactly once without marking complete or overwriting content", async () => {
    const value = await row();
    const response = await feature().putUpload(request(value.id), value.id);
    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await rows())[0]?.uploadedAt).toBeNull();
    expect(
      (
        await feature().putUpload(
          request(value.id, { body: bytes("xyz") }),
          value.id,
        )
      ).status,
    ).toBe(409);
    expect(await store.readHead(value.storageKey, 3)).toEqual(bytes("abc"));
  });
  it("rejects a missing or failed body with a private 400 and no published object", async () => {
    const value = await row();
    for (const body of [
      undefined,
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(new Error("private-body-detail"));
        },
      }),
    ]) {
      const init: RequestInit & { duplex: "half" } = {
        method: "PUT",
        headers: { Origin: "https://floor.test", "Content-Length": "3" },
        body,
        duplex: "half",
      };
      const response = await feature().putUpload(
        new Request(`https://floor.test/api/uploads/${value.id}`, init),
        value.id,
      );
      expect(response.status).toBe(400);
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(await response.text()).toBe("");
      expect(await store.stat(value.storageKey)).toBeNull();
    }
    expect(logError).not.toHaveBeenCalled();
  });
  it("cleans an upload that crosses its expiration while streaming", async () => {
    const value = await row();
    const write = store.writeStream.bind(store);
    vi.spyOn(store, "writeStream").mockImplementationOnce(async (...args) => {
      const result = await write(...args);
      instant = new Date(instant.getTime() + UPLOAD_LIFETIME_MS);
      return result;
    });
    expect(
      (await feature().putUpload(request(value.id), value.id)).status,
    ).toBe(404);
    expect(await rows()).toEqual([]);
    expect(await store.stat(value.storageKey)).toBeNull();
  });
  it("removes a PUT object when its reservation was discarded while streaming", async () => {
    const value = await row();
    const write = store.writeStream.bind(store);
    vi.spyOn(store, "writeStream").mockImplementationOnce(async (...args) => {
      await feature().discardUploads({ attachmentIds: [value.id] });
      return write(...args);
    });
    expect(
      (await feature().putUpload(request(value.id), value.id)).status,
    ).toBe(404);
    expect(await store.stat(value.storageKey)).toBeNull();
  });
  it.each([false, true])(
    "preserves an object completed before the PUT postcheck, attached=%s",
    async (attached) => {
      const value = await row();
      const write = store.writeStream.bind(store);
      vi.spyOn(store, "writeStream").mockImplementationOnce(async (...args) => {
        const result = await write(...args);
        expect(
          (await feature().completeUploads({ attachmentIds: [value.id] })).ok,
        ).toBe(true);
        if (attached) await attach(value);
        return result;
      });
      expect(
        (await feature().putUpload(request(value.id), value.id)).status,
      ).toBe(204);
      expect(await store.readHead(value.storageKey, 3)).toEqual(bytes("abc"));
    },
  );
  it("reports disk failures as fixed 500 without paths or body contents", async () => {
    const value = await row();
    vi.spyOn(store, "writeStream").mockRejectedValue(
      new Error("private-location"),
    );
    const response = await feature().putUpload(request(value.id), value.id);
    expect(response.status).toBe(500);
    expect(await response.text()).toBe("");
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      "File upload request failed.",
    );
  });

  it("completes a mixed batch with public metadata, missing and unuploaded results", async () => {
    const image = await row({ name: "사진.png", size: png().length });
    await putObject(image, png());
    const file = await row({ name: "가짜사진.png" });
    await putObject(file);
    const notUploaded = await row();
    const foreign = await row({ uploaderId: actors.admin.userId });
    const result = await feature().completeUploads({
      attachmentIds: [image.id, file.id, notUploaded.id, foreign.id],
    });
    expect(result).toEqual({
      ok: true,
      data: [
        {
          attachmentId: image.id,
          ok: true,
          name: "사진.png",
          size: png().length,
          kind: "image",
          width: 120,
          height: 80,
        },
        {
          attachmentId: file.id,
          ok: true,
          name: "가짜사진.png",
          size: 3,
          kind: "file",
          width: null,
          height: null,
        },
        { attachmentId: notUploaded.id, ok: false, reason: "not_uploaded" },
        { attachmentId: foreign.id, ok: false, reason: "not_found" },
      ],
    });
    expect(JSON.stringify(result)).not.toContain("storageKey");
    expect(JSON.stringify(result)).not.toContain(actors.member.email);
    expect(
      (
        await uploadDal.readOwnedUploads(
          actors.member.userId,
          [image.id],
          database.db,
        )
      )[0]?.contentType,
    ).toBe("image/png");
  });
  it("tries a larger image header once and falls back to a general file", async () => {
    const value = await row({ size: 8 });
    await putObject(value, png().slice(0, 8));
    const read = vi.spyOn(store, "readHead");
    const result = await feature().completeUploads({
      attachmentIds: [value.id],
    });
    expect(result).toMatchObject({
      ok: true,
      data: [{ ok: true, kind: "file", width: null, height: null }],
    });
    expect(read.mock.calls.map(([, size]) => size)).toEqual([
      256 * 1024,
      1024 * 1024,
    ]);
  });
  it("returns the stored result without rereading a completed object", async () => {
    const value = await row();
    await putObject(value);
    const input = { attachmentIds: [value.id] };
    const result = await feature().completeUploads(input);
    const stat = vi.spyOn(store, "stat");
    const read = vi.spyOn(store, "readHead");
    expect(await feature().completeUploads(input)).toEqual(result);
    await attach(value);
    expect(await feature().completeUploads(input)).toEqual(result);
    expect(stat).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
  it("returns the same completed result when two callers reach the conditional update together", async () => {
    const value = await row();
    await putObject(value);
    const original = uploadDal.completePendingUpload;
    vi.spyOn(uploadDal, "completePendingUpload").mockImplementationOnce(
      async (...args) => {
        await original(...args);
        return original(...args);
      },
    );
    const first = await feature().completeUploads({
      attachmentIds: [value.id],
    });
    const second = await feature().completeUploads({
      attachmentIds: [value.id],
    });
    expect(first).toEqual(second);
    expect(first).toMatchObject({ ok: true, data: [{ ok: true }] });
    expect(await store.stat(value.storageKey)).toEqual({ size: 3 });
  });
  it("does not recreate an attachment discarded during completion", async () => {
    const value = await row();
    await putObject(value);
    const original = uploadDal.completePendingUpload;
    vi.spyOn(uploadDal, "completePendingUpload").mockImplementationOnce(
      async (...args) => {
        await feature().discardUploads({ attachmentIds: [value.id] });
        return original(...args);
      },
    );
    expect(
      await feature().completeUploads({ attachmentIds: [value.id] }),
    ).toEqual({
      ok: true,
      data: [{ attachmentId: value.id, ok: false, reason: "not_found" }],
    });
    expect(await store.stat(value.storageKey)).toBeNull();
  });
  it("returns not_found if the reservation disappears before reading its head", async () => {
    const value = await row();
    await putObject(value);
    const read = store.readHead.bind(store);
    vi.spyOn(store, "readHead").mockImplementationOnce(async (...args) => {
      await feature().discardUploads({ attachmentIds: [value.id] });
      return read(...args);
    });
    expect(
      await feature().completeUploads({ attachmentIds: [value.id] }),
    ).toEqual({
      ok: true,
      data: [{ attachmentId: value.id, ok: false, reason: "not_found" }],
    });
    expect(logError).not.toHaveBeenCalled();
  });
  it.each(["blocked_type", "size_mismatch"] as const)(
    "retires a %s pending ID before deleting its object",
    async (reason) => {
      const body =
        reason === "blocked_type"
          ? bytes("<html>bad</html>")
          : bytes("bad size");
      const value = await row({
        name: "사진.png",
        size: reason === "blocked_type" ? body.length : 3,
      });
      await putObject(value, body);
      const remove = store.remove.bind(store);
      vi.spyOn(store, "remove").mockImplementationOnce(async (key) => {
        expect(await rows()).toEqual([]);
        await remove(key);
      });
      expect(
        await feature().completeUploads({ attachmentIds: [value.id] }),
      ).toEqual({
        ok: true,
        data: [{ attachmentId: value.id, ok: false, reason }],
      });
      expect(await store.stat(value.storageKey)).toBeNull();
      expect(
        (await feature().putUpload(request(value.id), value.id)).status,
      ).toBe(404);
    },
  );
  it("does not remove an object when conditional rejection lost to a valid completion", async () => {
    const value = await row();
    await putObject(value);
    vi.spyOn(store, "stat").mockResolvedValueOnce({ size: 100 });
    const original = uploadDal.rejectPendingUpload;
    vi.spyOn(uploadDal, "rejectPendingUpload").mockImplementationOnce(
      async (...args) => {
        await uploadDal.completePendingUpload(
          {
            attachmentId: value.id,
            userId: actors.member.userId,
            now: instant,
            cutoff: new Date(instant.getTime() - UPLOAD_LIFETIME_MS),
            kind: "file",
            contentType: "application/octet-stream",
            width: null,
            height: null,
          },
          database.db,
        );
        return original(...args);
      },
    );
    const remove = vi.spyOn(store, "remove");
    expect(
      await feature().completeUploads({ attachmentIds: [value.id] }),
    ).toMatchObject({ ok: true, data: [{ ok: true }] });
    expect(remove).not.toHaveBeenCalled();
    expect(await store.readHead(value.storageKey, 3)).toEqual(bytes("abc"));
  });
  it("rejects expiration and malformed completion batches without changing rows", async () => {
    const value = await row({
      createdAt: new Date(instant.getTime() - UPLOAD_LIFETIME_MS),
    });
    expect(
      await feature().completeUploads({ attachmentIds: [value.id] }),
    ).toEqual({
      ok: true,
      data: [{ attachmentId: value.id, ok: false, reason: "not_found" }],
    });
    for (const attachmentIds of [
      [],
      ["bad"],
      Array.from({ length: 11 }, () => crypto.randomUUID()),
    ])
      expect(await feature().completeUploads({ attachmentIds })).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
    expect(await rows()).toHaveLength(1);
  });
  it("discards only owned unattached rows and only their returned objects", async () => {
    const ready = await row({ uploadedAt: instant });
    await putObject(ready);
    const uploading = await row();
    await putObject(uploading);
    const other = await row({ uploaderId: actors.admin.userId });
    await putObject(other);
    const attached = await row();
    await attach(attached);
    await putObject(attached);
    const remove = vi.spyOn(store, "remove");
    const input = {
      attachmentIds: [ready.id, uploading.id, other.id, attached.id],
    };
    expect(await feature().discardUploads(input)).toEqual({
      ok: true,
      data: {},
    });
    expect(remove).toHaveBeenCalledTimes(2);
    expect(await feature().discardUploads(input)).toEqual({
      ok: true,
      data: {},
    });
    expect(remove).toHaveBeenCalledTimes(2);
    expect(await rows()).toHaveLength(2);
    expect(await store.stat(attached.storageKey)).toEqual({ size: 3 });
    expect(await store.stat(other.storageKey)).toEqual({ size: 3 });
  });
  it("keeps a committed discard successful when object removal fails and never logs the key", async () => {
    const value = await row();
    await putObject(value);
    vi.spyOn(store, "remove").mockRejectedValue(new Error(value.storageKey));
    expect(
      await feature().discardUploads({ attachmentIds: [value.id] }),
    ).toEqual({ ok: true, data: {} });
    expect(await rows()).toEqual([]);
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      "File object cleanup failed.",
    );
  });
});
