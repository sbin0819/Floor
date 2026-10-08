import { canBookAs } from "@/features/bookings/access";
import {
  bookingActionDependencies,
  publishBookingChange,
  type BookingDependencies,
} from "@/features/bookings/action-factory";
import {
  createDeskParts,
  isDeskPartSelectable,
  type DeskPart,
} from "@/features/bookings/desk-parts";
import {
  bookingLimitRole,
  resolveBookingLimits,
} from "@/features/bookings/limits";
import { daysBetweenDates } from "@/features/bookings/rules";
import { createDeskBookingSchema } from "@/features/bookings/schema";
import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { getRoleSettings, withTransaction } from "@/lib/dal";
import { getBranch } from "@/lib/dal/branches";
import { fillBookingDefaultBranch } from "@/lib/dal/booking-default-branch";
import {
  insertBooking,
  listSpaceBlocks,
  lockFloorForBooking,
  lockSpaceForBooking,
} from "@/lib/dal/bookings";
import {
  getDeskForAccess,
  hasUserDeskBookingOverlap,
  lockDeskBookingActor,
} from "@/lib/dal/desks";
import { loadPermissionContext } from "@/lib/permissions/context";
import { getOpenHours } from "@/lib/time/open-hours";
import { localDate } from "@/lib/time/zoned";

function deskRange(
  date: string,
  part: DeskPart,
  branch: { timezone: string; openHours: unknown },
  now: Date,
) {
  const daysAhead = daysBetweenDates(localDate(now, branch.timezone), date);
  if (daysAhead < 0 || daysAhead > 60) throw new ActionError("INVALID_INPUT");
  if (!getOpenHours(branch.openHours, date))
    throw new ActionError("OUTSIDE_HOURS");
  const parts = createDeskParts({
    date,
    timeZone: branch.timezone,
    openHours: branch.openHours,
  });
  const range = parts.find((range) => range.part === part);
  if (!range || !isDeskPartSelectable(part, parts, now))
    throw new ActionError("INVALID_INPUT");
  return {
    during: { start: new Date(range.start), end: new Date(range.end) },
    daysAhead,
  };
}

export function createDeskBookingAction(
  dependencies: BookingDependencies = {},
) {
  const db = dependencies.database;
  return createAction(
    {
      input: createDeskBookingSchema,
      authorize: async ({ session, input }) => {
        const row = await getDeskForAccess(input.deskId, db);
        if (!row) throw new ActionError("NOT_FOUND");
        return canBookAs(
          await loadPermissionContext(session, row.area.floor.branchId, db),
          row.area,
          input.teamId,
        );
      },
      handler: async ({ session, input }) => {
        const now = (dependencies.now ?? (() => new Date()))();
        const row = await getDeskForAccess(input.deskId, db);
        if (!row) throw new ActionError("NOT_FOUND");
        if (!row.desk.bookable) throw new ActionError("INVALID_INPUT");
        const branch = await getBranch(row.area.floor.branchId, db);
        if (!branch) throw new ActionError("NOT_FOUND");
        const { during, daysAhead } = deskRange(
          input.date,
          input.part,
          branch,
          now,
        );
        const booking = await withTransaction(async (transaction) => {
          if (!(await lockFloorForBooking(row.area.floor.id, transaction)))
            throw new ActionError("NOT_FOUND");
          const area = await lockSpaceForBooking(row.area.id, transaction);
          if (
            !area ||
            area.archivedAt ||
            area.floorId !== row.area.floor.id ||
            area.type !== "desk_area" ||
            area.bookable
          )
            throw new ActionError("NOT_FOUND");
          const desk = await lockSpaceForBooking(row.desk.id, transaction);
          if (
            !desk ||
            desk.archivedAt ||
            desk.type !== "desk" ||
            desk.parentId !== area.id ||
            desk.floorId !== area.floorId
          )
            throw new ActionError("NOT_FOUND");
          if (!desk.bookable) throw new ActionError("INVALID_INPUT");
          if (
            !(await lockDeskBookingActor(
              { userId: session.userId, teamId: input.teamId },
              transaction,
            ))
          )
            throw new ActionError("FORBIDDEN");
          const current = await getDeskForAccess(desk.id, transaction);
          if (!current) throw new ActionError("NOT_FOUND");
          const context = await loadPermissionContext(
            session,
            branch.id,
            transaction,
          );
          if (!canBookAs(context, current.area, input.teamId))
            throw new ActionError("FORBIDDEN");
          const settings = await getRoleSettings(branch.id, transaction);
          const role = bookingLimitRole(context, branch.id, input.teamId);
          const limits = resolveBookingLimits(role, settings[role]?.limits);
          if (limits.maxDaysAhead !== null && daysAhead > limits.maxDaysAhead)
            throw new ActionError("LIMIT_EXCEEDED", { message: "days_ahead" });
          if (
            await hasUserDeskBookingOverlap(session.userId, during, transaction)
          )
            throw new ActionError("LIMIT_EXCEEDED", {
              message: "desk_per_person",
            });
          if (
            (
              await listSpaceBlocks(
                { spaceIds: [area.id, desk.id], during },
                transaction,
              )
            ).length
          )
            throw new ActionError("SPACE_BLOCKED");
          const created = await insertBooking(
            {
              spaceId: desk.id,
              userId: session.userId,
              teamId: input.teamId,
              title: null,
              attendeeCount: null,
              during,
              createdAt: now,
            },
            transaction,
          );
          await fillBookingDefaultBranch(
            session.userId,
            branch.id,
            transaction,
          );
          return created;
        }, db);
        await publishBookingChange(
          row.area.floor.id,
          row.area.id,
          dependencies,
        );
        return { bookingId: booking.id };
      },
    },
    bookingActionDependencies(dependencies),
  );
}
