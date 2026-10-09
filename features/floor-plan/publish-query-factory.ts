import { z } from "zod";
import { readBookingNow } from "@/features/bookings/request-clock";
import {
  classifyDeskPart,
  createDeskParts,
} from "@/features/bookings/desk-parts";
import { ActionError, type ActionResult } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import {
  getPlanEditorFloor,
  listPlanEditorSources,
  listPlanEditorSpaces,
} from "@/lib/dal/floor-plan-editor";
import {
  listPlanVersions,
  listPublishBookings,
} from "@/lib/dal/floor-plan-publish";
import { can } from "@/lib/permissions/can";
import { loadPermissionContext } from "@/lib/permissions/context";
import { localDate, localTime } from "@/lib/time/zoned";
import type { FloorPlanQueryDependencies } from "./query-factory";
import {
  blockingPlanSpaceIds,
  bookingPlanIssues,
  calculatePlanPublication,
  changedPlanShapes,
} from "./publish-calculation";
import {
  planVersionsSchema,
  previewPublishFloorPlanSchema,
  type PlanVersionsInput,
  type PreviewPublishFloorPlanInput,
} from "./publish-schema";
import type { PlanPublishPreview, PlanVersion } from "./publish-types";

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new ActionError("INVALID_INPUT");
  return result.data;
}
export function createPlanPublishQueries(
  dependencies: FloorPlanQueryDependencies = {},
) {
  const db = dependencies.database;
  const readSession = dependencies.requireSession ?? requireSession;
  async function access(
    branchId: string,
    floorId: string,
    session: Awaited<ReturnType<typeof readSession>>,
  ) {
    const [floor, context] = await Promise.all([
      getPlanEditorFloor(floorId, db),
      loadPermissionContext(session, branchId, db),
    ]);
    if (
      !floor ||
      floor.branchId !== branchId ||
      !context.staffBranchIds.includes(branchId)
    )
      throw new ActionError("NOT_FOUND");
    if (!can(context, "plan.edit", { branchId }))
      throw new ActionError("FORBIDDEN");
    return { floor, context };
  }
  return {
    async previewPublishFloorPlan(
      input: PreviewPublishFloorPlanInput,
    ): Promise<ActionResult<PlanPublishPreview>> {
      try {
        const session = await readSession();
        const value = parse(previewPublishFloorPlanSchema, input);
        const { floor, context } = await access(
          value.branchId,
          value.floorId,
          session,
        );
        const now = dependencies.now?.() ?? readBookingNow(db !== undefined);
        const [sources, spaces, bookings] = await Promise.all([
          listPlanEditorSources(floor.id, session.userId, db),
          listPlanEditorSpaces(floor.id, session.userId, db, now),
          listPublishBookings(
            {
              floorId: floor.id,
              userId: session.userId,
              now,
              showBooker: can(context, "booking.manage_all", {
                branchId: floor.branchId,
              }),
            },
            db,
          ),
        ]);
        const draft = sources.find((source) => source.status === "draft");
        if (
          !draft ||
          draft.planId !== value.expectedDraftId ||
          draft.revision !== value.revision
        )
          throw new ActionError("STALE");
        const planContext = {
          floorId: floor.id,
          floorAccess: floor.access,
          floorAllowedTeamIds: floor.allowedTeamIds,
          spaces,
        };
        const { document, issues, diff } = calculatePlanPublication(
          draft.document,
          planContext,
        );
        const blockingIds = new Set(
          diff ? blockingPlanSpaceIds(diff, planContext) : [],
        );
        const blocking = bookings.filter((booking) =>
          blockingIds.has(booking.spaceId),
        );
        return {
          ok: true,
          data: {
            draft: {
              planId: draft.planId,
              version: draft.version,
              revision: draft.revision,
            },
            changedShapes: changedPlanShapes(
              document,
              sources.find((source) => source.status === "published")
                ?.document ?? null,
            ),
            seats: {
              created: diff?.created.map((seat) => seat.name) ?? [],
              renamed:
                diff?.updated
                  .filter((seat) => seat.name !== seat.previousName)
                  .map((seat) => ({
                    from: seat.previousName,
                    to: seat.name,
                  })) ?? [],
              archived: diff?.archived.map((seat) => seat.name) ?? [],
            },
            issues: [
              ...issues,
              ...(diff ? bookingPlanIssues(diff, blocking, planContext) : []),
            ],
            blockingBookings: blocking.map((booking) => {
              const date = localDate(booking.during.start, floor.timezone);
              const part = classifyDeskPart(
                booking.during,
                createDeskParts({
                  date,
                  timeZone: floor.timezone,
                  openHours: booking.openHours,
                }),
              );
              return {
                seatName: booking.seatName,
                date,
                part,
                timeRange: part
                  ? null
                  : `${localTime(booking.during.start, floor.timezone)}–${localTime(booking.during.end, floor.timezone)}`,
                bookerName: booking.bookerName,
              };
            }),
          },
        };
      } catch (error) {
        if (error instanceof ActionError)
          return {
            ok: false,
            code: error.code,
            ...(error.code === "PLAN_INVALID" && error.details.issues
              ? { issues: error.details.issues }
              : {}),
          };
        console.error("Plan publication preview failed.");
        return { ok: false, code: "INTERNAL" };
      }
    },
    async getPlanVersions(input: PlanVersionsInput): Promise<PlanVersion[]> {
      const session = await readSession();
      const value = parse(planVersionsSchema, input);
      await access(value.branchId, value.floorId, session);
      return (
        await listPlanVersions(value.floorId, session.userId, db)
      ).flatMap((row) =>
        row.status === "draft"
          ? []
          : [
              {
                ...row,
                status: row.status,
                publishedAt: row.publishedAt?.toISOString() ?? null,
              },
            ],
      );
    },
  };
}
