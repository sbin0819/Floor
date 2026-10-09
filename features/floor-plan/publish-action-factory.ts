import { createAction } from "@/lib/actions/create-action";
import { getPostgresError } from "@/lib/actions/errors";
import { reportPostCommitFailure } from "@/lib/actions/post-commit-log";
import { ActionError } from "@/lib/actions/result";
import { withTransaction } from "@/lib/dal";
import { lockAdminFloor } from "@/lib/dal/admin";
import {
  getFloorPlanDraftBase,
  getPlanEditorFloor,
  insertFloorPlanDraft,
  listPlanEditorSpaces,
  nextFloorPlanVersion,
} from "@/lib/dal/floor-plan-editor";
import {
  getRestorablePlan,
  listArchivedPlanDesks,
  lockChangedPlanSpaces,
  lockPlanBookings,
  lockPublishingDraft,
  lockPublishingSpaces,
  publishPlanRecord,
  replaceDraftVersion,
  writePublishedSeats,
} from "@/lib/dal/floor-plan-publish";
import { isBlockingPlanIssue } from "@/lib/floor-plan/issues";
import { floorPlanSchema, seatLabelSchema } from "@/lib/floor-plan/schema";
import { floorChannel } from "@/lib/realtime/channels";
import { getRealtimePublisher } from "@/lib/realtime/server";
import {
  adminActionDependencies,
  checkAdminFloor,
  type AdminDependencies,
} from "@/features/admin/action-factory";
import {
  blockingPlanSpaceIds,
  bookingPlanIssues,
  calculatePlanPublication,
} from "./publish-calculation";
import {
  publishFloorPlanSchema,
  restorePlanVersionSchema,
} from "./publish-schema";
import type {
  PublishFloorPlanResult,
  RestorePlanVersionResult,
} from "./publish-types";

export function createPlanPublishActions(dependencies: AdminDependencies = {}) {
  const db = dependencies.database;
  const actionDependencies = adminActionDependencies(dependencies);
  const readNow = dependencies.now ?? (() => new Date());
  return {
    publishFloorPlan: createAction(
      {
        input: publishFloorPlanSchema,
        authorize: ({ session, input }) =>
          checkAdminFloor(session, input.floorId, "plan.edit", db),
        handler: async ({
          session,
          input,
        }): Promise<PublishFloorPlanResult> => {
          let result: PublishFloorPlanResult;
          try {
            result = await withTransaction(async (tx) => {
              if (!(await lockAdminFloor(input.floorId, "update", tx)))
                throw new ActionError("NOT_FOUND");
              const draft = await lockPublishingDraft(input.floorId, tx);
              if (
                !draft ||
                draft.id !== input.expectedDraftId ||
                draft.revision !== input.revision
              )
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
              await lockPublishingSpaces(input.floorId, tx);
              const [floor, spaces] = await Promise.all([
                getPlanEditorFloor(input.floorId, tx),
                listPlanEditorSpaces(input.floorId, session.userId, tx),
              ]);
              if (!floor) throw new ActionError("NOT_FOUND");
              const context = {
                floorId: floor.id,
                floorAccess: floor.access,
                floorAllowedTeamIds: floor.allowedTeamIds,
                spaces,
              };
              const { issues, diff } = calculatePlanPublication(
                draft.document,
                context,
              );
              if (!diff) throw new ActionError("PLAN_INVALID", { issues });
              const blockingIds = blockingPlanSpaceIds(diff, context);
              await lockChangedPlanSpaces(
                input.floorId,
                [
                  ...new Set([
                    ...diff.updated.map((seat) => seat.id),
                    ...blockingIds,
                  ]),
                ].sort(),
                tx,
              );
              const bookings = await lockPlanBookings(blockingIds, tx);
              // 잠금을 기다린 시간까지 반영한 하나의 시각으로 예약과 게시 시각을 판정한다.
              const now = readNow();
              issues.push(
                ...bookingPlanIssues(
                  diff,
                  bookings.filter((booking) => booking.during.end > now),
                  context,
                ),
              );
              if (issues.some(isBlockingPlanIssue))
                throw new ActionError("PLAN_INVALID", { issues });
              await writePublishedSeats(input.floorId, diff, now, tx);
              const row = await publishPlanRecord(
                {
                  floorId: input.floorId,
                  planId: draft.id,
                  revision: input.revision,
                  userId: session.userId,
                  now,
                },
                tx,
              );
              if (!row) throw new ActionError("STALE");
              return {
                ...row,
                publishedAt: now.toISOString(),
                seats: {
                  created: diff.created.length,
                  renamed: diff.updated.filter(
                    (seat) => seat.name !== seat.previousName,
                  ).length,
                  archived: diff.archived.length,
                },
              };
            }, db);
          } catch (error) {
            const postgres = getPostgresError(error);
            if (
              postgres?.code === "23505" &&
              postgres.constraint === "spaces_floor_name_unique"
            )
              throw new ActionError("PLAN_INVALID", {
                issues: [
                  {
                    code: "SEAT_LABEL_DUPLICATE",
                    message: "이 층에 같은 이름의 좌석이나 공간이 있어요.",
                  },
                ],
              });
            throw error;
          }
          try {
            await (dependencies.publisher ?? getRealtimePublisher()).publish(
              floorChannel(input.floorId),
              {
                type: "plan.published",
                floorId: input.floorId,
                version: result.version,
              },
            );
          } catch {
            reportPostCommitFailure(
              "Plan publication notification failed.",
              dependencies.logError,
            );
          }
          return result;
        },
      },
      actionDependencies,
    ),
    restorePlanVersion: createAction(
      {
        input: restorePlanVersionSchema,
        authorize: ({ session, input }) =>
          checkAdminFloor(session, input.floorId, "plan.edit", db),
        handler: ({ session, input }): Promise<RestorePlanVersionResult> =>
          withTransaction(async (tx) => {
            if (!(await lockAdminFloor(input.floorId, "update", tx)))
              throw new ActionError("NOT_FOUND");
            const draft = await lockPublishingDraft(input.floorId, tx);
            const base = await getFloorPlanDraftBase(input.floorId, tx);
            if (!base) throw new ActionError("NOT_FOUND");
            if (
              (draft?.id ?? null) !== input.expectedDraftId ||
              (draft?.revision ?? null) !== input.revision ||
              base.publishedPlanId !== input.basePlanId
            )
              throw new ActionError("STALE");
            if (
              !(await checkAdminFloor(session, input.floorId, "plan.edit", tx))
            )
              throw new ActionError("FORBIDDEN");
            const source = await getRestorablePlan(
              input.floorId,
              input.version,
              tx,
            );
            if (!source) throw new ActionError("NOT_FOUND");
            const parsed = floorPlanSchema.safeParse(source.document);
            if (!parsed.success) throw new ActionError("PLAN_INVALID");
            const archived = new Map(
              (
                await listArchivedPlanDesks(
                  input.floorId,
                  parsed.data.seats.map((seat) => seat.spaceId.toLowerCase()),
                  tx,
                )
              ).map((seat) => [seat.id, seat.name]),
            );
            const restored = floorPlanSchema.safeParse({
              ...parsed.data,
              seats: parsed.data.seats.map((seat) => {
                const name = archived.get(seat.spaceId.toLowerCase());
                if (name === undefined) return seat;
                const label = seatLabelSchema.safeParse(seat.label ?? name);
                // 예전의 긴 이름은 자르지 않고, 새 좌석 이름을 명시적으로 고르게 한다.
                const { label: previousLabel, ...geometry } = seat;
                void previousLabel;
                return {
                  ...geometry,
                  spaceId: crypto.randomUUID(),
                  ...(label.success ? { label: label.data } : {}),
                };
              }),
            });
            if (!restored.success) throw new ActionError("PLAN_INVALID");
            const document = restored.data;
            const now = readNow();
            const row = draft
              ? await replaceDraftVersion(
                  {
                    planId: draft.id,
                    revision: draft.revision,
                    document,
                    backgroundImage: source.backgroundImage,
                    userId: session.userId,
                    now,
                  },
                  tx,
                )
              : await insertFloorPlanDraft(
                  {
                    floorId: input.floorId,
                    version: await nextFloorPlanVersion(input.floorId, tx),
                    document,
                    backgroundImage: source.backgroundImage,
                    userId: session.userId,
                    now,
                  },
                  tx,
                );
            if (!row) throw new ActionError("STALE");
            return {
              floorId: input.floorId,
              basePlanId: base.publishedPlanId,
              document,
              draft: row,
              savedAt: now.toISOString(),
            };
          }, db),
      },
      actionDependencies,
    ),
  };
}
