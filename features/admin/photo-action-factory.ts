import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createAction } from "@/lib/actions/create-action";
import { reportPostCommitFailure } from "@/lib/actions/post-commit-log";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import { withTransaction, type DalDatabase } from "@/lib/dal";
import { lockAdminSpace } from "@/lib/dal/admin";
import {
  insertSpacePhoto,
  listPhotosForMutation,
  readPhotoForMutation,
  readPhotoSpaceId,
  removeSpacePhoto,
  writeSpacePhotoAlt,
  writeSpacePhotoOrder,
} from "@/lib/dal/photo-write";
import { adminObjectKey } from "@/lib/storage/admin-keys";
import {
  AdminStorageMissingError,
  AdminStoragePreconditionError,
  InvalidPendingWebpError,
  type AdminObjectHead,
  type AdminObjectStorage,
} from "@/lib/storage/admin-types";
import { getAdminObjectStorage } from "@/lib/storage/r2";
import {
  verifyAdminWebp,
  verifyPendingWebp,
} from "@/lib/storage/verify-pending-webp";
import {
  checkAdminSpace,
  publishAdminSpaceChange,
  type AdminDependencies,
} from "./action-factory";
import {
  confirmSpacePhotoUploadSchema,
  createSpacePhotoUploadSchema,
  deleteSpacePhotoSchema,
  reorderSpacePhotosSchema,
  updateSpacePhotoAltSchema,
  SPACE_PHOTO_EXPIRY_SECONDS,
  SPACE_PHOTO_MAX_BYTES,
  SPACE_PHOTO_SIZE,
  SPACE_PHOTO_UPLOAD_LIMIT,
  type ConfirmSpacePhotoUploadResult,
  type CreateSpacePhotoUploadResult,
  type SpacePhotoMutationResult,
} from "./photo-schema";

export type SpacePhotoDependencies = AdminDependencies & {
  storage?: AdminObjectStorage | null;
};
const metadataSchema = z.object({
  purpose: z.literal("space-photo"),
  "uploader-id": z.uuid(),
  "space-id": z.uuid(),
  "expected-size": z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(SPACE_PHOTO_MAX_BYTES)),
  "expires-at": z.iso.datetime(),
});
const photoPath = (id: string) => `/api/space-photos/${id}.webp`;

export function createSpacePhotoActions(
  dependencies: SpacePhotoDependencies = {},
) {
  const db = dependencies.database;
  const now = () => dependencies.now?.() ?? new Date();
  const report = () =>
    reportPostCommitFailure(
      "Space photo operation failed.",
      dependencies.logError,
    );
  const actionDependencies = {
    ...(dependencies.getSession ? { getSession: dependencies.getSession } : {}),
    logError: report,
  };
  const storage = () =>
    dependencies.storage === undefined
      ? getAdminObjectStorage()
      : dependencies.storage;
  const requireStorage = () => {
    const objects = storage();
    if (!objects)
      throw new ActionError("FORBIDDEN", { message: "files_disabled" });
    return objects;
  };
  const removeObject = async (objects: AdminObjectStorage, key: string) => {
    try {
      await objects.remove(key);
    } catch {
      report();
    }
  };
  const authorizeSpace = (session: Session, spaceId: string) =>
    checkAdminSpace(session, spaceId, "space.manage", db);
  const authorizePhoto = async (session: Session, photoId: string) => {
    const spaceId = await readPhotoSpaceId(photoId, db);
    if (!spaceId) throw new ActionError("NOT_FOUND");
    return authorizeSpace(session, spaceId);
  };
  const lockSpace = async (
    session: Session,
    spaceId: string,
    tx: DalDatabase,
  ) => {
    const space = await lockAdminSpace(spaceId, tx);
    if (!space) throw new ActionError("NOT_FOUND");
    if (!(await checkAdminSpace(session, spaceId, "space.manage", tx)))
      throw new ActionError("FORBIDDEN");
    return space;
  };
  const checkLimit = (count: number) => {
    if (count >= SPACE_PHOTO_UPLOAD_LIMIT)
      throw new ActionError("LIMIT_EXCEEDED");
  };
  const mutationTarget = async (photoId: string) => {
    const photo = await readPhotoForMutation(photoId, db);
    if (!photo) throw new ActionError("NOT_FOUND");
    return photo;
  };
  return {
    createSpacePhotoUpload: createAction(
      {
        input: createSpacePhotoUploadSchema,
        authorize: ({ session, input }) =>
          authorizeSpace(session, input.spaceId),
        async handler({
          session,
          input,
        }): Promise<CreateSpacePhotoUploadResult> {
          const objects = requireStorage();
          checkLimit((await listPhotosForMutation(input.spaceId, db)).length);
          const uploadId = randomUUID();
          const url = await objects.createUploadUrl(
            adminObjectKey({ kind: "pending", uploadId }),
            {
              contentType: "image/webp",
              contentLength: input.size,
              expiresIn: SPACE_PHOTO_EXPIRY_SECONDS,
              metadata: {
                purpose: "space-photo",
                "uploader-id": session.userId,
                "space-id": input.spaceId,
                "expected-size": String(input.size),
                "expires-at": new Date(
                  now().getTime() + SPACE_PHOTO_EXPIRY_SECONDS * 1000,
                ).toISOString(),
              },
            },
          );
          return { uploadId, url };
        },
      },
      actionDependencies,
    ),
    confirmSpacePhotoUpload: createAction(
      {
        input: confirmSpacePhotoUploadSchema,
        authorize: ({ session, input }) =>
          authorizeSpace(session, input.spaceId),
        async handler({
          session,
          input,
        }): Promise<ConfirmSpacePhotoUploadResult> {
          const objects = requireStorage();
          const pendingKey = adminObjectKey({
            kind: "pending",
            uploadId: input.uploadId,
          });
          const key = adminObjectKey({
            kind: "space-photo",
            photoId: input.uploadId,
          });
          const path = photoPath(input.uploadId);
          const existing = await readPhotoForMutation(input.uploadId, db);
          if (
            existing &&
            (existing.spaceId !== input.spaceId || !existing.pathMatches)
          )
            throw new ActionError("NOT_FOUND");
          const binding = (head: AdminObjectHead) => {
            const parsed = metadataSchema.safeParse(head.metadata);
            if (
              !parsed.success ||
              parsed.data["uploader-id"] !== session.userId ||
              parsed.data["space-id"] !== input.spaceId
            )
              throw new ActionError("NOT_FOUND");
            return parsed.data;
          };
          const verifiedFinal = async () => {
            const head = await objects.head(key);
            if (!head) throw new ActionError("NOT_FOUND");
            const metadata = binding(head);
            if (metadata["expected-size"] !== head.size)
              throw new ActionError("INVALID_INPUT");
            return verifyAdminWebp(
              key,
              { maxBytes: SPACE_PHOTO_MAX_BYTES, size: SPACE_PHOTO_SIZE, head },
              objects,
            );
          };
          const verifyAndCopyPending = async () => {
            const pending = await objects.head(pendingKey);
            if (!pending)
              return { image: await verifiedFinal(), copied: false };
            const metadata = binding(pending);
            if (Date.parse(metadata["expires-at"]) <= now().getTime()) {
              await removeObject(objects, pendingKey);
              throw new ActionError("INVALID_INPUT");
            }
            let image: AdminObjectHead & { width: number; height: number };
            try {
              if (metadata["expected-size"] !== pending.size)
                throw new InvalidPendingWebpError();
              image = await verifyPendingWebp(
                pendingKey,
                {
                  maxBytes: SPACE_PHOTO_MAX_BYTES,
                  size: SPACE_PHOTO_SIZE,
                  head: pending,
                },
                objects,
              );
            } catch (error) {
              if (error instanceof AdminStorageMissingError)
                return { image: await verifiedFinal(), copied: false };
              if (error instanceof InvalidPendingWebpError) {
                await removeObject(objects, pendingKey);
                throw new ActionError("INVALID_INPUT");
              }
              throw error;
            }
            const copied =
              (await objects.copy(pendingKey, key, {
                sourceEtag: image.etag,
                ifAbsent: true,
              })) === "created";
            return { image: copied ? image : await verifiedFinal(), copied };
          };
          let upload: Awaited<ReturnType<typeof verifyAndCopyPending>>;
          try {
            // 성공한 행의 재확인에는 만료되거나 삭제된 pending을 요구하지 않는다.
            upload = existing
              ? { image: await verifiedFinal(), copied: false }
              : await verifyAndCopyPending();
          } catch (error) {
            if (error instanceof InvalidPendingWebpError)
              throw new ActionError("INVALID_INPUT");
            if (error instanceof AdminStoragePreconditionError)
              throw new ActionError("STALE");
            throw error;
          }
          let callbackCompleted = false;
          let changed = false;
          let floorId: string;
          try {
            floorId = await withTransaction(async (tx) => {
              const space = await lockSpace(session, input.spaceId, tx);
              const photos = await listPhotosForMutation(input.spaceId, tx);
              const saved = photos.find((photo) => photo.id === input.uploadId);
              if (!upload.copied) {
                // 복사 패자는 DB에 연결된 같은 파일만 확인하고, 승자 대신 연결하지 않는다.
                if (!saved || saved.path !== path)
                  throw new ActionError("STALE");
              } else {
                if (saved) throw new ActionError("STALE");
                if (
                  Date.parse(upload.image.metadata["expires-at"] ?? "") <=
                  now().getTime()
                )
                  throw new ActionError("INVALID_INPUT");
                checkLimit(photos.length);
                if (photos.some((photo, index) => photo.sortOrder !== index))
                  await writeSpacePhotoOrder(
                    input.spaceId,
                    photos.map((photo) => photo.id),
                    tx,
                  );
                if (
                  !(await insertSpacePhoto(
                    {
                      id: input.uploadId,
                      spaceId: input.spaceId,
                      path,
                      alt: input.alt,
                      sortOrder: photos.length,
                    },
                    tx,
                  ))
                )
                  throw new ActionError("STALE");
                changed = true;
              }
              callbackCompleted = true;
              return space.floorId;
            }, db);
          } catch (error) {
            // COMMIT 응답이 유실될 수 있으므로 콜백 완료 뒤 오류에서는 파일을 보존한다.
            if (upload.copied && !callbackCompleted)
              await removeObject(objects, key);
            throw error;
          }
          await removeObject(objects, pendingKey);
          if (changed)
            await publishAdminSpaceChange(floorId, input.spaceId, dependencies);
          return { photoId: input.uploadId };
        },
      },
      actionDependencies,
    ),
    reorderSpacePhotos: createAction(
      {
        input: reorderSpacePhotosSchema,
        authorize: ({ session, input }) =>
          authorizeSpace(session, input.spaceId),
        async handler({ session, input }): Promise<SpacePhotoMutationResult> {
          const floorId = await withTransaction(async (tx) => {
            const space = await lockSpace(session, input.spaceId, tx);
            const photos = await listPhotosForMutation(input.spaceId, tx);
            const ids = new Set(photos.map((photo) => photo.id));
            if (
              photos.length !== input.photoIds.length ||
              input.photoIds.some((id) => !ids.has(id))
            )
              throw new ActionError("INVALID_INPUT");
            if (
              (await writeSpacePhotoOrder(input.spaceId, input.photoIds, tx))
                .length !== photos.length
            )
              throw new ActionError("STALE");
            return space.floorId;
          }, db);
          await publishAdminSpaceChange(floorId, input.spaceId, dependencies);
          return { spaceId: input.spaceId };
        },
      },
      actionDependencies,
    ),
    updateSpacePhotoAlt: createAction(
      {
        input: updateSpacePhotoAltSchema,
        authorize: ({ session, input }) =>
          authorizePhoto(session, input.photoId),
        async handler({ session, input }): Promise<SpacePhotoMutationResult> {
          const photo = await mutationTarget(input.photoId);
          const floorId = await withTransaction(async (tx) => {
            const space = await lockSpace(session, photo.spaceId, tx);
            if (
              !(await writeSpacePhotoAlt(
                { ...input, spaceId: photo.spaceId },
                tx,
              ))
            )
              throw new ActionError("NOT_FOUND");
            return space.floorId;
          }, db);
          await publishAdminSpaceChange(floorId, photo.spaceId, dependencies);
          return { spaceId: photo.spaceId };
        },
      },
      actionDependencies,
    ),
    deleteSpacePhoto: createAction(
      {
        input: deleteSpacePhotoSchema,
        authorize: ({ session, input }) =>
          authorizePhoto(session, input.photoId),
        async handler({ session, input }): Promise<SpacePhotoMutationResult> {
          const photo = await mutationTarget(input.photoId);
          const deleted = await withTransaction(async (tx) => {
            const space = await lockSpace(session, photo.spaceId, tx);
            const row = await removeSpacePhoto(
              { photoId: input.photoId, spaceId: photo.spaceId },
              tx,
            );
            if (!row) throw new ActionError("NOT_FOUND");
            const remaining = await listPhotosForMutation(photo.spaceId, tx);
            await writeSpacePhotoOrder(
              photo.spaceId,
              remaining.map((item) => item.id),
              tx,
            );
            return { floorId: space.floorId, row };
          }, db);
          if (deleted.row.path === photoPath(deleted.row.id)) {
            try {
              const objects = storage();
              if (objects)
                await Promise.all([
                  removeObject(
                    objects,
                    adminObjectKey({
                      kind: "space-photo",
                      photoId: deleted.row.id,
                    }),
                  ),
                  removeObject(
                    objects,
                    adminObjectKey({
                      kind: "pending",
                      uploadId: deleted.row.id,
                    }),
                  ),
                ]);
              else report();
            } catch {
              report();
            }
          }
          await publishAdminSpaceChange(
            deleted.floorId,
            photo.spaceId,
            dependencies,
          );
          return { spaceId: photo.spaceId };
        },
      },
      actionDependencies,
    ),
  };
}
