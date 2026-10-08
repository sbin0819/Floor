import { z } from "zod";
import {
  createAction,
  type ActionDependencies,
} from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { getSession } from "@/lib/auth/session";
import { canWriteRoom, lockMessageSpace } from "@/lib/dal/chat-access";
import { lockRoomForMessage } from "@/lib/dal/chat-write";
import * as uploads from "@/lib/dal/chat-uploads";
import {
  withTransaction,
  type DalDatabase,
  type TransactionDatabase,
} from "@/lib/dal/database";
import { isSameOrigin } from "@/lib/http/same-origin";
import {
  createMemoryRateLimiter,
  type RateLimiter,
} from "@/lib/rate-limit/memory";
import { getFileStorage } from "@/lib/storage";
import { sniff } from "@/lib/storage/file-kind";
import { readImageSize } from "@/lib/storage/image-size";
import {
  isLocalFileStorage,
  StorageBodyError,
  StorageSizeMismatchError,
  type FileStorage,
} from "@/lib/storage/types";
import { createUploadsSchema, uploadIdsSchema } from "./upload-schema";
import {
  MAX_STORAGE_BYTES,
  UPLOAD_LIFETIME_MS,
  type CompletedUpload,
  type UploadCompletion,
  type UploadTarget,
} from "./upload-types";

export type ChatUploadDependencies = Partial<ActionDependencies> & {
  database?: DalDatabase & TransactionDatabase;
  now?: () => Date;
  storage?: FileStorage;
  limiter?: RateLimiter;
};

const limiter = createMemoryRateLimiter();
const cutoffOf = (now: Date) => new Date(now.getTime() - UPLOAD_LIFETIME_MS);
const completed = (row: uploads.UploadRow): CompletedUpload => ({
  attachmentId: row.id,
  name: row.name,
  size: row.size,
  kind: row.kind,
  width: row.width,
  height: row.height,
});
const usable = (
  row: uploads.UploadRow | undefined,
  now: Date,
): row is uploads.UploadRow =>
  row !== undefined &&
  (row.messageId !== null || row.createdAt.getTime() > cutoffOf(now).getTime());
const respond = (status: number) =>
  new Response(null, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });

export function createChatUploads(dependencies: ChatUploadDependencies = {}) {
  const database = dependencies.database;
  const now = () => dependencies.now?.() ?? new Date();
  const storage = () => dependencies.storage ?? getFileStorage();
  const log = (message: string) =>
    (dependencies.logError ?? console.error)(message);
  const actionDependencies = {
    ...dependencies,
    logError: () => log("File upload request failed."),
  };
  const removeObjects = async (
    store: FileStorage,
    rows: readonly { storageKey: string }[],
  ) => {
    await Promise.all(
      rows.map(async ({ storageKey }) => {
        try {
          await store.remove(storageKey);
        } catch {
          log("File object cleanup failed.");
        }
      }),
    );
  };
  const requireWritable = async (
    userId: string,
    roomId: string,
    instant: Date,
    db?: DalDatabase,
  ) => {
    const access = await canWriteRoom(userId, roomId, db, instant);
    if (!access.room) throw new ActionError("NOT_FOUND");
    if (
      !access.canWrite ||
      (access.room.kind === "dm" &&
        (access.room.directMembership?.mine !== "active" ||
          access.room.directMembership.peer !== "active"))
    )
      throw new ActionError("FORBIDDEN");
    return access.room;
  };
  const readOne = async (userId: string, attachmentId: string) =>
    (await uploads.readOwnedUploads(userId, [attachmentId], database))[0];
  const finishAgain = async (
    userId: string,
    attachmentId: string,
    instant: Date,
  ): Promise<UploadCompletion> => {
    const row = await readOne(userId, attachmentId);
    return usable(row, instant) && row.uploadedAt
      ? { ...completed(row), ok: true }
      : { attachmentId, ok: false, reason: "not_found" };
  };
  const rejectFile = async (
    store: FileStorage,
    userId: string,
    attachmentId: string,
    reason: "size_mismatch" | "blocked_type",
    instant: Date,
  ): Promise<UploadCompletion> => {
    const removed = await uploads.rejectPendingUpload(
      userId,
      attachmentId,
      database,
    );
    if (!removed.length) return finishAgain(userId, attachmentId, instant);
    await removeObjects(store, removed);
    return { attachmentId, ok: false, reason };
  };
  const completeOne = async (
    store: FileStorage,
    userId: string,
    attachmentId: string,
    instant: Date,
  ): Promise<UploadCompletion> => {
    const row = await readOne(userId, attachmentId);
    if (!usable(row, instant))
      return { attachmentId, ok: false, reason: "not_found" };
    if (row.uploadedAt) return { ...completed(row), ok: true };
    const stat = await store.stat(row.storageKey);
    if (!stat) return { attachmentId, ok: false, reason: "not_uploaded" };
    if (stat.size !== row.size)
      return rejectFile(store, userId, attachmentId, "size_mismatch", instant);
    let head: Uint8Array;
    try {
      head = await store.readHead(row.storageKey, 256 * 1024);
    } catch (error) {
      if (!(await readOne(userId, attachmentId)))
        return { attachmentId, ok: false, reason: "not_found" };
      throw error;
    }
    const type = sniff(head);
    if (type === "blocked")
      return rejectFile(store, userId, attachmentId, "blocked_type", instant);
    let dimensions = type ? readImageSize(head) : null;
    if (type && !dimensions) {
      try {
        dimensions = readImageSize(
          await store.readHead(row.storageKey, 1024 * 1024),
        );
      } catch (error) {
        if (!(await readOne(userId, attachmentId)))
          return { attachmentId, ok: false, reason: "not_found" };
        throw error;
      }
    }
    const changed = await uploads.completePendingUpload(
      {
        attachmentId,
        userId,
        now: instant,
        cutoff: cutoffOf(instant),
        kind: type && dimensions ? "image" : "file",
        contentType: type && dimensions ? type : "application/octet-stream",
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null,
      },
      database,
    );
    return changed
      ? { ...completed(changed), ok: true }
      : finishAgain(userId, attachmentId, instant);
  };

  return {
    createUploads: createAction(
      {
        input: createUploadsSchema,
        authorize: "none",
        async handler({ session, input }): Promise<UploadTarget[]> {
          const store = storage();
          if (store.kind === "disabled") throw new ActionError("FORBIDDEN");
          const instant = now();
          const room = await requireWritable(
            session.userId,
            input.roomId,
            instant,
            database,
          );
          if (
            !(dependencies.limiter ?? limiter).consume(
              `chat:upload:${session.userId}`,
              30,
              60_000,
            ).allowed
          )
            throw new ActionError("LIMIT_EXCEEDED");
          const result = await withTransaction(async (tx) => {
            if (!(await uploads.lockUploadQuota(session.userId, tx)))
              throw new ActionError("NOT_FOUND");
            await lockMessageSpace(room.spaceId, tx);
            await lockRoomForMessage(input.roomId, tx);
            await requireWritable(session.userId, input.roomId, instant, tx);
            const removed = await uploads.removeExpiredUploads(
              session.userId,
              cutoffOf(instant),
              tx,
            );
            const size = await uploads.totalUploadBytes(
              session.userId,
              cutoffOf(instant),
              tx,
            );
            if (
              size + input.files.reduce((total, file) => total + file.size, 0) >
              MAX_STORAGE_BYTES
            )
              throw new ActionError("LIMIT_EXCEEDED", {
                message: "storage_quota",
              });
            const date = new Intl.DateTimeFormat("sv-SE", {
              timeZone: "Asia/Seoul",
              year: "numeric",
              month: "2-digit",
            })
              .format(instant)
              .replace("-", "/");
            const rows = await uploads.insertPendingUploads(
              input.files.map((file) => {
                const id = crypto.randomUUID();
                return {
                  id,
                  roomId: input.roomId,
                  uploaderId: session.userId,
                  storageKey: `chat/${date}/${id}`,
                  name: file.name,
                  size: file.size,
                  contentType: "application/octet-stream",
                  kind: "file" as const,
                  createdAt: instant,
                };
              }),
              tx,
            );
            return { rows, removed };
          }, database);
          await removeObjects(store, result.removed);
          try {
            return await Promise.all(
              result.rows.map(async (row) => {
                const target = await store.createUploadTarget(row.storageKey, {
                  size: row.size,
                });
                return {
                  attachmentId: row.id,
                  uploadUrl: target.url,
                  method: target.method,
                  headers: target.headers,
                };
              }),
            );
          } catch {
            // 일부 업로드 주소만 만들어졌어도 이번 묶음은 한 번 폐기한다.
            try {
              const removed = await uploads.discardUnattachedUploads(
                session.userId,
                result.rows.map((row) => row.id),
                database,
              );
              await removeObjects(store, removed);
            } catch {
              log("File upload reservation cleanup failed.");
            }
            throw new ActionError("INTERNAL");
          }
        },
      },
      actionDependencies,
    ),
    completeUploads: createAction(
      {
        input: uploadIdsSchema,
        authorize: "none",
        async handler({ session, input }): Promise<UploadCompletion[]> {
          const store = storage();
          if (store.kind === "disabled") throw new ActionError("FORBIDDEN");
          const instant = now();
          return Promise.all(
            input.attachmentIds.map((id) =>
              completeOne(store, session.userId, id, instant),
            ),
          );
        },
      },
      actionDependencies,
    ),
    discardUploads: createAction(
      {
        input: uploadIdsSchema,
        authorize: "none",
        async handler({ session, input }) {
          const removed = await uploads.discardUnattachedUploads(
            session.userId,
            input.attachmentIds,
            database,
          );
          await removeObjects(storage(), removed);
          return {};
        },
      },
      actionDependencies,
    ),
    async putUpload(request: Request, attachmentId: string): Promise<Response> {
      try {
        const session = await (dependencies.getSession ?? getSession)();
        if (!session) return respond(401);
        if (!isSameOrigin(request)) return respond(403);
        const store = storage();
        if (!isLocalFileStorage(store)) return respond(404);
        if (!z.uuid().safeParse(attachmentId).success) return respond(404);
        const row = await readOne(session.userId, attachmentId.toLowerCase());
        if (!usable(row, now()) || row.uploadedAt || row.messageId)
          return respond(404);
        const length = request.headers.get("Content-Length");
        if (
          !length ||
          !/^\d+$/.test(length) ||
          Number(length) !== row.size ||
          !request.body
        )
          return respond(400);
        try {
          const written = await store.writeStream(
            row.storageKey,
            request.body,
            row.size,
          );
          if (written === "exists") return respond(409);
        } catch (error) {
          if (
            error instanceof StorageSizeMismatchError ||
            error instanceof StorageBodyError
          )
            return respond(400);
          throw error;
        }
        const current = await readOne(session.userId, row.id);
        if (!usable(current, now())) {
          const removed = current
            ? await uploads.discardUnattachedUploads(
                session.userId,
                [row.id],
                database,
              )
            : [{ storageKey: row.storageKey }];
          await removeObjects(store, removed);
          return respond(404);
        }
        // 완료 요청이나 전송이 먼저 끝났으면 게시한 정상 객체를 보존한다.
        return respond(204);
      } catch {
        log("File upload request failed.");
        return respond(500);
      }
    },
  };
}
