import { canBookAs } from "@/features/bookings/access";
import { assertAttendeeCapacity } from "@/features/bookings/capacity";
import {
  assertParticipantCapacity,
  assertParticipantEligibility,
  invalidParticipants,
} from "@/features/bookings/participant-validation";
import {
  getParticipantEligibility,
  insertBookingParticipants,
  lockParticipantBookingActor,
} from "@/lib/dal/booking-participants";
import {
  bookingActionDependencies,
  publishBookingChange,
  type BookingDependencies,
} from "@/features/bookings/action-factory";
import {
  bookingLimitRole,
  checkBookingLimits,
  resolveBookingLimits,
} from "@/features/bookings/limits";
import {
  bookingDayRange,
  bookingMinutes,
  daysBetweenDates,
  validateBookingTime,
} from "@/features/bookings/rules";
import {
  createBookingSchema,
  defaultBranchSchema,
} from "@/features/bookings/schema";
import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { getRoleSettings, getSpaceForAccess, withTransaction } from "@/lib/dal";
import { getBranch } from "@/lib/dal/branches";
import { fillBookingDefaultBranch } from "@/lib/dal/booking-default-branch";
import {
  insertBooking,
  listSpaceBlocks,
  lockBookingActor,
  lockFloorForBooking,
  lockSpaceForBooking,
  setUserDefaultBranch,
  sumBookedMinutes,
} from "@/lib/dal/bookings";
import { loadPermissionContext } from "@/lib/permissions/context";
import { localDate } from "@/lib/time/zoned";

function assertBookable(space: { bookable: boolean; type: string }) {
  if (!space.bookable || space.type === "desk")
    throw new ActionError("INVALID_INPUT");
}
function assertTime(input: Parameters<typeof validateBookingTime>[0]) {
  const reason = validateBookingTime(input);
  if (reason)
    throw new ActionError(
      reason === "outside_hours" || reason === "closed_day"
        ? "OUTSIDE_HOURS"
        : "INVALID_INPUT",
    );
}

export function createBookingActions(dependencies: BookingDependencies = {}) {
  const db = dependencies.database;
  return {
    createBooking: createAction(
      {
        input: createBookingSchema,
        authorize: async ({ session, input }) => {
          const space = await getSpaceForAccess(input.spaceId, db);
          if (!space || space.archivedAt) throw new ActionError("NOT_FOUND");
          return canBookAs(
            await loadPermissionContext(session, space.floor.branchId, db),
            space,
            input.teamId,
          );
        },
        handler: async ({ session, input }) => {
          const now = (dependencies.now ?? (() => new Date()))();
          const space = await getSpaceForAccess(input.spaceId, db);
          if (!space || space.archivedAt) throw new ActionError("NOT_FOUND");
          assertBookable(space);
          const participants = input.participants ?? [];
          if (participants.some(({ userId }) => userId === session.userId))
            invalidParticipants();
          assertAttendeeCapacity(space.capacity, input.attendeeCount);
          if (participants.length) {
            assertParticipantCapacity({
              capacity: space.capacity,
              attendeeCount: input.attendeeCount,
              participantCount: participants.length,
            });
            assertParticipantEligibility(
              session.userId,
              participants,
              await getParticipantEligibility(
                session.userId,
                participants.map(({ userId }) => userId),
                db,
              ),
            );
          }
          const branch = await getBranch(space.floor.branchId, db);
          if (!branch) throw new ActionError("NOT_FOUND");
          const during = {
            start: new Date(input.start),
            end: new Date(input.end),
          };
          assertTime({
            ...during,
            now,
            timeZone: branch.timezone,
            openHours: branch.openHours,
          });
          const booking = await withTransaction(async (transaction) => {
            if (!(await lockFloorForBooking(space.floor.id, transaction)))
              throw new ActionError("NOT_FOUND");
            const locked = await lockSpaceForBooking(space.id, transaction);
            if (
              !locked ||
              locked.archivedAt ||
              locked.floorId !== space.floor.id
            )
              throw new ActionError("NOT_FOUND");
            assertBookable(locked);
            if (
              !(await (participants.length
                ? lockParticipantBookingActor(
                    {
                      userId: session.userId,
                      teamId: input.teamId,
                      participantIds: participants.map(({ userId }) => userId),
                    },
                    transaction,
                  )
                : lockBookingActor(
                    { userId: session.userId, teamId: input.teamId },
                    transaction,
                  )))
            ) {
              if (participants.length)
                assertParticipantEligibility(
                  session.userId,
                  participants,
                  await getParticipantEligibility(
                    session.userId,
                    participants.map(({ userId }) => userId),
                    transaction,
                  ),
                );
              throw new ActionError("FORBIDDEN");
            }
            // 운영자의 변경과 겹쳐도 잠금 전에 읽은 접근 결과를 재사용하지 않는다.
            const current = await getSpaceForAccess(space.id, transaction);
            const context = await loadPermissionContext(
              session,
              space.floor.branchId,
              transaction,
            );
            if (!current || !canBookAs(context, current, input.teamId))
              throw new ActionError("FORBIDDEN");
            assertAttendeeCapacity(current.capacity, input.attendeeCount);
            if (participants.length) {
              assertParticipantCapacity({
                capacity: current.capacity,
                attendeeCount: input.attendeeCount,
                participantCount: participants.length,
              });
              assertParticipantEligibility(
                session.userId,
                participants,
                await getParticipantEligibility(
                  session.userId,
                  participants.map(({ userId }) => userId),
                  transaction,
                ),
              );
            }
            const settings = await getRoleSettings(branch.id, transaction);
            const role = bookingLimitRole(context, branch.id, input.teamId);
            const limits = resolveBookingLimits(role, settings[role]?.limits);
            const date = localDate(during.start, branch.timezone);
            const usedMinutes = await sumBookedMinutes(
              {
                branchId: branch.id,
                during: bookingDayRange(date, branch.timezone),
                actor: input.teamId
                  ? { teamId: input.teamId }
                  : { userId: session.userId },
              },
              transaction,
            );
            const reason = checkBookingLimits({
              limits,
              durationMinutes: bookingMinutes(during.start, during.end),
              usedMinutes,
              daysAhead: daysBetweenDates(
                localDate(now, branch.timezone),
                date,
              ),
            });
            if (reason)
              throw new ActionError("LIMIT_EXCEEDED", { message: reason });
            if (
              (
                await listSpaceBlocks(
                  { spaceIds: [space.id], during },
                  transaction,
                )
              ).length
            )
              throw new ActionError("SPACE_BLOCKED");
            const created = await insertBooking(
              {
                spaceId: space.id,
                userId: session.userId,
                teamId: input.teamId,
                title: input.title,
                attendeeCount: input.attendeeCount ?? null,
                during,
                createdAt: now,
              },
              transaction,
            );
            if (participants.length)
              await insertBookingParticipants(
                created.id,
                participants.map(({ userId }) => userId),
                transaction,
              );
            await fillBookingDefaultBranch(
              session.userId,
              branch.id,
              transaction,
            );
            return created;
          }, db);
          await publishBookingChange(space.floor.id, space.id, dependencies);
          return { bookingId: booking.id };
        },
      },
      bookingActionDependencies(dependencies),
    ),
    setDefaultBranch: createAction(
      {
        input: defaultBranchSchema,
        authorize: "none",
        handler: async ({ session, input }) => {
          if (!(await getBranch(input.branchId, db)))
            throw new ActionError("NOT_FOUND");
          if (!(await setUserDefaultBranch(session.userId, input.branchId, db)))
            throw new ActionError("NOT_FOUND");
          return { branchId: input.branchId };
        },
      },
      bookingActionDependencies(dependencies),
    ),
  };
}
