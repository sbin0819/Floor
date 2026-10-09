import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import { reportPostCommitFailure } from "@/lib/actions/post-commit-log";
import { requireSession } from "@/lib/auth/session";
import { readPlanBackground } from "@/lib/dal/plan-backgrounds";
import { can } from "@/lib/permissions/can";
import { loadPermissionContext } from "@/lib/permissions/context";
import { assertAdminObjectKey } from "@/lib/storage/admin-keys";
import type { AdminObjectStorage } from "@/lib/storage/admin-types";
import { getAdminObjectStorage } from "@/lib/storage/r2";
import type { FloorPlanQueryDependencies } from "./query-factory";

export const planBackgroundHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
};
export function createPlanBackgroundQueries(
  dependencies: FloorPlanQueryDependencies & {
    storage?: AdminObjectStorage | null;
    logError?: (error: unknown) => void;
  } = {},
) {
  return {
    async getPlanBackground(planId: string): Promise<Response> {
      try {
        const session = await (dependencies.requireSession ?? requireSession)();
        const id = z.uuid().safeParse(planId);
        if (!id.success) throw new ActionError("NOT_FOUND");
        const row = await readPlanBackground(
          id.data.toLowerCase(),
          dependencies.database,
        );
        if (!row?.backgroundImage) throw new ActionError("NOT_FOUND");
        const context = await loadPermissionContext(
          session,
          row.branchId,
          dependencies.database,
        );
        if (
          !context.staffBranchIds.includes(row.branchId) ||
          !can(context, "plan.edit", { branchId: row.branchId })
        )
          throw new ActionError("NOT_FOUND");
        // 복원한 버전은 이전 planId의 파일을 공유한다. 인가한 DB 컬럼만 신뢰한다.
        if (!row.backgroundImage.startsWith("plan-backgrounds/"))
          throw new ActionError("NOT_FOUND");
        try {
          assertAdminObjectKey(row.backgroundImage);
        } catch {
          throw new ActionError("NOT_FOUND");
        }
        const storage =
          dependencies.storage === undefined
            ? getAdminObjectStorage()
            : dependencies.storage;
        if (!storage) throw new ActionError("NOT_FOUND");
        const stream = await storage.readStream(row.backgroundImage);
        if (!stream) throw new ActionError("NOT_FOUND");
        return new Response(stream, {
          headers: { ...planBackgroundHeaders, "Content-Type": "image/webp" },
        });
      } catch (error) {
        if (
          error instanceof ActionError &&
          ["UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND"].includes(error.code)
        )
          return new Response(null, {
            status: error.code === "UNAUTHENTICATED" ? 401 : 404,
            headers: planBackgroundHeaders,
          });
        reportPostCommitFailure(
          "Plan background read failed.",
          dependencies.logError,
        );
        return new Response(null, {
          status: 500,
          headers: planBackgroundHeaders,
        });
      }
    },
  };
}
