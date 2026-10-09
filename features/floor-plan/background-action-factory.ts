import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  checkAdminFloor,
  type AdminDependencies,
} from "@/features/admin/action-factory";
import { createAction } from "@/lib/actions/create-action";
import { reportPostCommitFailure } from "@/lib/actions/post-commit-log";
import { ActionError } from "@/lib/actions/result";
import { withTransaction } from "@/lib/dal";
import { lockAdminFloor } from "@/lib/dal/admin";
import {
  lockBackgroundDraft,
  readBackgroundDraft,
  updatePlanBackground,
} from "@/lib/dal/plan-backgrounds";
import { adminObjectKey } from "@/lib/storage/admin-keys";
import {
  AdminStoragePreconditionError,
  AdminStorageMissingError,
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
  confirmPlanBackgroundUploadSchema,
  createPlanBackgroundUploadSchema,
  PLAN_BACKGROUND_EXPIRY_SECONDS,
  PLAN_BACKGROUND_MAX_BYTES,
  type ConfirmPlanBackgroundUploadResult,
  type CreatePlanBackgroundUploadResult,
} from "./background-schema";

export type PlanBackgroundDependencies = AdminDependencies & {
  storage?: AdminObjectStorage | null;
};
const metadataSchema = z.object({
  purpose: z.literal("plan-background"),
  "uploader-id": z.uuid(),
  "floor-id": z.uuid(),
  "plan-id": z.uuid(),
  "expected-size": z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().max(PLAN_BACKGROUND_MAX_BYTES)),
  "expires-at": z.iso.datetime(),
});

export function createPlanBackgroundActions(
  dependencies: PlanBackgroundDependencies = {},
) {
  const db = dependencies.database;
  const now = () => dependencies.now?.() ?? new Date();
  const report = () =>
    reportPostCommitFailure(
      "Plan background operation failed.",
      dependencies.logError,
    );
  const actionDependencies = {
    ...(dependencies.getSession ? { getSession: dependencies.getSession } : {}),
    logError: report,
  };
  const storage = () => {
    const value =
      dependencies.storage === undefined
        ? getAdminObjectStorage()
        : dependencies.storage;
    if (!value)
      throw new ActionError("FORBIDDEN", { message: "files_disabled" });
    return value;
  };
  const remove = async (objects: AdminObjectStorage, key: string) => {
    try {
      await objects.remove(key);
    } catch {
      report();
    }
  };
  return {
    createPlanBackgroundUpload: createAction(
      {
        input: createPlanBackgroundUploadSchema,
        authorize: ({ session, input }) =>
          checkAdminFloor(session, input.floorId, "plan.edit", db),
        async handler({
          session,
          input,
        }): Promise<CreatePlanBackgroundUploadResult> {
          const objects = storage();
          const draft = await readBackgroundDraft(input.floorId, db);
          if (!draft) throw new ActionError("NOT_FOUND");
          if (draft.id !== input.expectedDraftId)
            throw new ActionError("STALE");
          const uploadId = randomUUID();
          const url = await objects.createUploadUrl(
            adminObjectKey({ kind: "pending", uploadId }),
            {
              contentType: "image/webp",
              contentLength: input.size,
              expiresIn: PLAN_BACKGROUND_EXPIRY_SECONDS,
              metadata: {
                purpose: "plan-background",
                "uploader-id": session.userId,
                "floor-id": input.floorId,
                "plan-id": draft.id,
                "expected-size": String(input.size),
                "expires-at": new Date(
                  now().getTime() + PLAN_BACKGROUND_EXPIRY_SECONDS * 1000,
                ).toISOString(),
              },
            },
          );
          return { uploadId, planId: draft.id, url };
        },
      },
      actionDependencies,
    ),
    confirmPlanBackgroundUpload: createAction(
      {
        input: confirmPlanBackgroundUploadSchema,
        authorize: ({ session, input }) =>
          checkAdminFloor(session, input.floorId, "plan.edit", db),
        async handler({
          session,
          input,
        }): Promise<ConfirmPlanBackgroundUploadResult> {
          const objects = storage();
          const pendingKey = adminObjectKey({
            kind: "pending",
            uploadId: input.uploadId,
          });
          const draft = await readBackgroundDraft(input.floorId, db);
          if (!draft) throw new ActionError("STALE");
          const key = adminObjectKey({
            kind: "plan-background",
            planId: draft.id,
            uploadId: input.uploadId,
          });
          const binding = (head: AdminObjectHead) => {
            const parsed = metadataSchema.safeParse(head.metadata);
            if (
              !parsed.success ||
              parsed.data["uploader-id"] !== session.userId ||
              parsed.data["floor-id"] !== input.floorId
            )
              throw new ActionError("NOT_FOUND");
            if (parsed.data["plan-id"] !== draft.id)
              throw new ActionError("STALE");
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
              { maxBytes: PLAN_BACKGROUND_MAX_BYTES, maxLongSide: 4096, head },
              objects,
            );
          };
          const verifyAndCopyPending = async () => {
            const pending = await objects.head(pendingKey);
            // 다른 확인 요청이 이미 커밋하고 pending을 지운 경우도 아래 잠긴 행으로 판정한다.
            if (!pending)
              return { image: await verifiedFinal(), copied: false };
            const metadata = binding(pending);
            if (Date.parse(metadata["expires-at"]) <= now().getTime()) {
              await remove(objects, pendingKey);
              throw new ActionError("INVALID_INPUT");
            }
            let image: AdminObjectHead & { width: number; height: number };
            try {
              if (metadata["expected-size"] !== pending.size)
                throw new InvalidPendingWebpError();
              image = await verifyPendingWebp(
                pendingKey,
                {
                  maxBytes: PLAN_BACKGROUND_MAX_BYTES,
                  maxLongSide: 4096,
                  head: pending,
                },
                objects,
              );
            } catch (error) {
              if (error instanceof AdminStorageMissingError)
                return { image: await verifiedFinal(), copied: false };
              if (error instanceof InvalidPendingWebpError) {
                await remove(objects, pendingKey);
                throw new ActionError("INVALID_INPUT");
              }
              if (error instanceof AdminStoragePreconditionError)
                throw new ActionError("STALE");
              throw error;
            }
            let copied: boolean;
            try {
              copied =
                (await objects.copy(pendingKey, key, {
                  sourceEtag: image.etag,
                  ifAbsent: true,
                })) === "created";
            } catch (error) {
              if (error instanceof AdminStoragePreconditionError)
                throw new ActionError("STALE");
              throw error;
            }
            return { image: copied ? image : await verifiedFinal(), copied };
          };
          // 성공한 재요청은 만료되거나 삭제된 pending을 다시 만들지 않는다.
          const { image, copied } =
            draft.backgroundImage === key
              ? { image: await verifiedFinal(), copied: false }
              : await verifyAndCopyPending();
          let callbackCompleted = false;
          try {
            await withTransaction(async (tx) => {
              if (!(await lockAdminFloor(input.floorId, "share", tx)))
                throw new ActionError("NOT_FOUND");
              const locked = await lockBackgroundDraft(input.floorId, tx);
              if (!locked || locked.id !== draft.id)
                throw new ActionError("STALE");
              if (
                !(await checkAdminFloor(
                  session,
                  input.floorId,
                  "plan.edit",
                  tx,
                ))
              )
                throw new ActionError("FORBIDDEN");
              if (!copied) {
                // 복사 패자는 승자의 커밋을 확인할 뿐, 대신 파일을 연결하지 않는다.
                if (locked.backgroundImage !== key)
                  throw new ActionError("STALE");
              } else {
                if (
                  Date.parse(image.metadata["expires-at"] ?? "") <=
                  now().getTime()
                )
                  throw new ActionError("INVALID_INPUT");
                if (
                  !(await updatePlanBackground(
                    { planId: draft.id, floorId: input.floorId, key },
                    tx,
                  ))
                )
                  throw new ActionError("STALE");
              }
              callbackCompleted = true;
            }, db);
          } catch (error) {
            // COMMIT 응답 유실 가능성이 있으면 연결된 객체를 지우지 않고 남긴다.
            if (copied && !callbackCompleted) await remove(objects, key);
            throw error;
          }
          await remove(objects, pendingKey);
          return {
            uploadId: input.uploadId,
            planId: draft.id,
            width: image.width,
            height: image.height,
          };
        },
      },
      actionDependencies,
    ),
  };
}
