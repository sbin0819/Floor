import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import { reportPostCommitFailure } from "@/lib/actions/post-commit-log";
import { requireSession } from "@/lib/auth/session";
import { readSpacePhotoAccess } from "@/lib/dal/space-photo-read";
import { canAccess } from "@/lib/permissions/can-access";
import { loadPermissionContext } from "@/lib/permissions/context";
import { adminObjectKey } from "@/lib/storage/admin-keys";
import type { AdminObjectStorage } from "@/lib/storage/admin-types";
import { getAdminObjectStorage } from "@/lib/storage/r2";
import type { AdminQueryDependencies } from "./query-factory";

export const spacePhotoErrorHeaders = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "Cross-Origin-Resource-Policy": "same-origin",
};
export function createSpacePhotoQueries(
  dependencies: AdminQueryDependencies & {
    storage?: AdminObjectStorage | null;
    logError?: (error: unknown) => void;
  } = {},
) {
  return {
    async getSpacePhoto(file: string): Promise<Response> {
      try {
        const session = await (dependencies.requireSession ?? requireSession)();
        if (!file.endsWith(".webp")) throw new ActionError("NOT_FOUND");
        const id = file.slice(0, -5);
        if (id !== id.toLowerCase() || !z.uuid().safeParse(id).success)
          throw new ActionError("NOT_FOUND");
        const [photo, context] = await Promise.all([
          readSpacePhotoAccess(id, session.userId, dependencies.database),
          loadPermissionContext(session, undefined, dependencies.database),
        ]);
        if (!photo) throw new ActionError("NOT_FOUND");
        const staff = context.staffBranchIds.includes(photo.floor.branchId);
        const visible =
          (staff || (!photo.archivedAt && photo.type !== "desk")) &&
          canAccess(context, photo);
        if (!visible && !photo.ownBooking) throw new ActionError("NOT_FOUND");
        const storage =
          dependencies.storage === undefined
            ? getAdminObjectStorage()
            : dependencies.storage;
        if (!storage) throw new ActionError("NOT_FOUND");
        const stream = await storage.readStream(
          adminObjectKey({ kind: "space-photo", photoId: photo.id }),
        );
        if (!stream) throw new ActionError("NOT_FOUND");
        return new Response(stream, {
          headers: {
            ...spacePhotoErrorHeaders,
            "Cache-Control": "private, max-age=31536000, immutable",
            "Content-Type": "image/webp",
          },
        });
      } catch (error) {
        if (
          error instanceof ActionError &&
          ["UNAUTHENTICATED", "NOT_FOUND", "FORBIDDEN"].includes(error.code)
        )
          return new Response(null, {
            status: error.code === "UNAUTHENTICATED" ? 401 : 404,
            headers: spacePhotoErrorHeaders,
          });
        reportPostCommitFailure(
          "Space photo read failed.",
          dependencies.logError,
        );
        return new Response(null, {
          status: 500,
          headers: spacePhotoErrorHeaders,
        });
      }
    },
  };
}
