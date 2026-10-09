import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { withTransaction } from "@/lib/dal";
import { lockAdminFloor } from "@/lib/dal/admin";
import {
  getFloorPlanDraftBase,
  insertFloorPlanDraft,
  lockFloorPlanDraft,
  nextFloorPlanVersion,
  updateFloorPlanDraft,
} from "@/lib/dal/floor-plan-editor";
import {
  adminActionDependencies,
  checkAdminFloor,
  type AdminDependencies,
} from "@/features/admin/action-factory";
import { saveFloorPlanDraftSchema } from "./editor-schema";
import type { SaveFloorPlanDraftResult } from "./editor-types";

export function createPlanEditorActions(dependencies: AdminDependencies = {}) {
  const db = dependencies.database;
  return {
    saveFloorPlanDraft: createAction(
      {
        input: saveFloorPlanDraftSchema,
        authorize: ({ session, input }) =>
          checkAdminFloor(session, input.floorId, "plan.edit", db),
        handler: ({ session, input }): Promise<SaveFloorPlanDraftResult> =>
          withTransaction(async (tx) => {
            let draft = await lockFloorPlanDraft(input.floorId, tx);
            if (!draft) {
              if (!(await lockAdminFloor(input.floorId, "update", tx)))
                throw new ActionError("NOT_FOUND");
              // 빈 결과에는 잠금이 없으므로 층 잠금을 얻은 뒤 경쟁한 첫 저장을 다시 확인한다.
              draft = await lockFloorPlanDraft(input.floorId, tx);
            }
            if (
              !(await checkAdminFloor(session, input.floorId, "plan.edit", tx))
            )
              throw new ActionError("FORBIDDEN");
            const base = await getFloorPlanDraftBase(input.floorId, tx);
            if (!base) throw new ActionError("NOT_FOUND");
            // 새 초안 세대의 revision이 재사용돼도 이전 게시본에서 시작한 저장은 받지 않는다.
            if (base.publishedPlanId !== input.basePlanId)
              throw new ActionError("STALE");
            const now = dependencies.now?.() ?? new Date();
            if (draft) {
              if (input.revision === null || draft.revision !== input.revision)
                throw new ActionError("STALE");
              const row = await updateFloorPlanDraft(
                {
                  planId: draft.id,
                  revision: input.revision,
                  document: input.document,
                  userId: session.userId,
                  now,
                },
                tx,
              );
              if (!row) throw new ActionError("STALE");
              return { ...row, savedAt: now.toISOString() };
            }
            if (input.revision !== null) throw new ActionError("STALE");
            const version = await nextFloorPlanVersion(input.floorId, tx);
            const row = await insertFloorPlanDraft(
              {
                floorId: input.floorId,
                version,
                document: input.document,
                backgroundImage: base.backgroundImage,
                userId: session.userId,
                now,
              },
              tx,
            );
            return { ...row, savedAt: now.toISOString() };
          }, db),
      },
      adminActionDependencies(dependencies),
    ),
  };
}
