import { canBookAs } from "./access";
import { assertAttendeeCapacity } from "./capacity";
import {
  bookingActionDependencies,
  evictBookingCalls,
  publishBookingChange,
  publishBookingChatEvents,
  type BookingDependencies,
} from "./action-factory";
import {
  bookingLimitRole,
  checkBookingLimits,
  resolveBookingLimits,
} from "./limits";
import {
  bookingDayRange,
  bookingMinutes,
  daysBetweenDates,
  validateBookingTime,
} from "./rules";
import { updateBookingSchema } from "./schema";
import type { BookingParticipantInput } from "./participant-input";
import { MAX_GUEST_PARTICIPANTS } from "./participants";
import {
  assertParticipantCapacity,
  assertParticipantEligibility,
  invalidParticipants,
} from "./participant-validation";
import {
  assertParticipantsLocked,
  withParticipantTransaction,
} from "./participant-transaction";
import {
  buildBookingNotifications,
  buildReminderNotifications,
  notificationBookingSnapshot,
} from "@/features/notifications/builders";
import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { getSpaceForAccess, type DalDatabase } from "@/lib/dal";
import { getBranch } from "@/lib/dal/branches";
import { readUserNames, recordMeetingMessages } from "@/lib/dal/chat-meeting";
import type { SystemMessageData } from "@/features/chat/system-messages";
import {
  getBookingWithLocation,
  listSpaceBlocks,
  lockFloorForBooking,
  lockSpaceForBooking,
  sumBookedMinutes,
} from "@/lib/dal/bookings";
import {
  getParticipantEligibility,
  insertBookingParticipants,
  listBookingParticipantIds,
  lockParticipantBooking,
  lockParticipantBookingActor,
} from "@/lib/dal/booking-participants";
import {
  removeBookingParticipants,
  updateBookingRecord,
} from "@/lib/dal/booking-update";
import {
  deleteBookingReminders,
  insertNotifications,
} from "@/lib/dal/notifications";
import {
  loadPermissionContext,
  loadPermissionData,
} from "@/lib/permissions/context";
import { localDate } from "@/lib/time/zoned";

type LocatedBooking = NonNullable<
  Awaited<ReturnType<typeof getBookingWithLocation>>
>;
type During = LocatedBooking["booking"]["during"];

function assertEditable(
  row: LocatedBooking | null,
  userId: string,
  now: Date,
): asserts row is LocatedBooking {
  if (
    !row ||
    row.booking.userId !== userId ||
    row.booking.status !== "confirmed" ||
    row.booking.during.end <= now ||
    row.space.archivedAt
  )
    throw new ActionError("NOT_FOUND");
  // 좌석의 access는 의미가 없으므로 접근 검사보다 먼저 걸러 낸다.
  if (row.space.type === "desk") throw new ActionError("INVALID_INPUT");
}

function assertChangedTime(
  booking: LocatedBooking["booking"],
  during: During,
  branch: LocatedBooking["branch"],
  now: Date,
) {
  const changed =
    booking.during.start.getTime() !== during.start.getTime() ||
    booking.during.end.getTime() !== during.end.getTime();
  if (!changed) return false;
  if (
    booking.during.start <= now ||
    localDate(during.start, branch.timezone) !==
      localDate(booking.during.start, branch.timezone)
  )
    throw new ActionError("INVALID_INPUT");
  const reason = validateBookingTime({
    ...during,
    now,
    timeZone: branch.timezone,
    openHours: branch.openHours,
  });
  if (reason)
    throw new ActionError(
      reason === "outside_hours" || reason === "closed_day"
        ? "OUTSIDE_HOURS"
        : "INVALID_INPUT",
    );
  return true;
}

function requestedParticipants(
  submitted: readonly BookingParticipantInput[],
  observedExisting: ReadonlySet<string>,
  currentIds: readonly string[],
) {
  const current = new Set(currentIds);
  return submitted.filter(
    ({ userId }) => !observedExisting.has(userId) || current.has(userId),
  );
}

async function assertParticipants(
  input: {
    ownerId: string;
    participants: readonly BookingParticipantInput[];
    currentIds: readonly string[];
    capacity: number | null;
    attendeeCount: number | null;
  },
  database?: DalDatabase,
) {
  assertAttendeeCapacity(input.capacity, input.attendeeCount);
  assertParticipantCapacity({
    ...input,
    participantCount: input.participants.length,
  });
  if (!input.participants.length) return;
  const rows = await getParticipantEligibility(
    input.ownerId,
    input.participants.map(({ userId }) => userId),
    database,
  );
  const current = new Set(input.currentIds);
  assertParticipantEligibility(
    input.ownerId,
    input.participants.filter(({ userId }) => !current.has(userId)),
    rows,
  );
  if (
    rows.length !== input.participants.length ||
    rows.filter(({ sharesTeam }) => !sharesTeam).length > MAX_GUEST_PARTICIPANTS
  )
    invalidParticipants();
}

export function createUpdateBookingAction(
  dependencies: BookingDependencies = {},
) {
  const db = dependencies.database;
  return createAction(
    {
      input: updateBookingSchema,
      authorize: async ({ session, input }) => {
        const row = await getBookingWithLocation(input.bookingId, db);
        assertEditable(
          row,
          session.userId,
          (dependencies.now ?? (() => new Date()))(),
        );
        const space = await getSpaceForAccess(row.space.id, db);
        if (!space) throw new ActionError("NOT_FOUND");
        return canBookAs(
          await loadPermissionContext(session, row.branch.id, db),
          space,
          row.booking.teamId,
        );
      },
      handler: async ({ session, input }) => {
        const now = (dependencies.now ?? (() => new Date()))();
        const original = await getBookingWithLocation(input.bookingId, db);
        assertEditable(original, session.userId, now);
        if (input.participants.some(({ userId }) => userId === session.userId))
          invalidParticipants();
        const initialIds = await listBookingParticipantIds(input.bookingId, db);
        const observedExisting = new Set([
          ...input.participantIdsAtLoad,
          ...initialIds,
        ]);
        const initialParticipants = requestedParticipants(
          input.participants,
          observedExisting,
          initialIds,
        );
        await assertParticipants(
          {
            ownerId: session.userId,
            participants: initialParticipants,
            currentIds: initialIds,
            capacity: original.space.capacity,
            attendeeCount: input.attendeeCount,
          },
          db,
        );
        const during = {
          start: new Date(input.start),
          end: new Date(input.end),
        };
        assertChangedTime(original.booking, during, original.branch, now);
        const result = await withParticipantTransaction(async (transaction) => {
          const row = await getBookingWithLocation(
            input.bookingId,
            transaction,
          );
          assertEditable(row, session.userId, now);
          const beforeLockIds = await listBookingParticipantIds(
            input.bookingId,
            transaction,
          );
          beforeLockIds.forEach((id) => observedExisting.add(id));
          const requested = requestedParticipants(
            input.participants,
            observedExisting,
            beforeLockIds,
          );
          const userIds = [
            ...new Set([
              session.userId,
              ...beforeLockIds,
              ...requested.map(({ userId }) => userId),
            ]),
          ];
          if (!(await lockFloorForBooking(row.floor.id, transaction)))
            throw new ActionError("NOT_FOUND");
          const space = await lockSpaceForBooking(row.space.id, transaction);
          if (!space || space.archivedAt || space.floorId !== row.floor.id)
            throw new ActionError("NOT_FOUND");
          if (space.type === "desk") throw new ActionError("INVALID_INPUT");
          if (
            !(await lockParticipantBookingActor(
              {
                userId: session.userId,
                teamId: row.booking.teamId,
                participantIds: userIds.filter((id) => id !== session.userId),
              },
              transaction,
            ))
          ) {
            await assertParticipants(
              {
                ownerId: session.userId,
                participants: requested,
                currentIds: beforeLockIds,
                capacity: space.capacity,
                attendeeCount: input.attendeeCount,
              },
              transaction,
            );
            throw new ActionError("FORBIDDEN");
          }
          const locked = await lockParticipantBooking(
            input.bookingId,
            transaction,
          );
          if (
            !locked ||
            locked.spaceId !== row.space.id ||
            locked.teamId !== row.booking.teamId
          )
            throw new ActionError("NOT_FOUND");
          assertEditable(
            { ...row, booking: locked, space },
            session.userId,
            now,
          );
          const currentIds = await listBookingParticipantIds(
            input.bookingId,
            transaction,
          );
          assertParticipantsLocked(userIds, currentIds);
          currentIds.forEach((id) => observedExisting.add(id));
          const participants = requestedParticipants(
            input.participants,
            observedExisting,
            currentIds,
          );
          const [current, branch, permission] = await Promise.all([
            getSpaceForAccess(space.id, transaction),
            getBranch(row.branch.id, transaction),
            loadPermissionData(session, row.branch.id, transaction),
          ]);
          if (!current || current.archivedAt || !branch)
            throw new ActionError("NOT_FOUND");
          if (!canBookAs(permission.context, current, locked.teamId))
            throw new ActionError("FORBIDDEN");
          await assertParticipants(
            {
              ownerId: session.userId,
              participants,
              currentIds,
              capacity: current.capacity,
              attendeeCount: input.attendeeCount,
            },
            transaction,
          );
          const timeChanged = assertChangedTime(locked, during, branch, now);
          if (timeChanged) {
            const role = bookingLimitRole(
              permission.context,
              branch.id,
              locked.teamId,
            );
            const limits = resolveBookingLimits(
              role,
              permission.settings[role]?.limits,
            );
            const date = localDate(during.start, branch.timezone);
            const usedMinutes = await sumBookedMinutes(
              {
                branchId: branch.id,
                during: bookingDayRange(date, branch.timezone),
                actor: locked.teamId
                  ? { teamId: locked.teamId }
                  : { userId: session.userId },
                excludeBookingId: locked.id,
              },
              transaction,
            );
            const reason = checkBookingLimits({
              limits,
              usedMinutes,
              durationMinutes: bookingMinutes(during.start, during.end),
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
          }
          const updated = await updateBookingRecord(
            {
              bookingId: locked.id,
              userId: session.userId,
              during,
              attendeeCount: input.attendeeCount,
              title: input.title,
              now,
            },
            transaction,
          );
          if (!updated) throw new ActionError("NOT_FOUND");
          const latestIds = await listBookingParticipantIds(
            input.bookingId,
            transaction,
          );
          assertParticipantsLocked(userIds, latestIds);
          const desiredIds = new Set(participants.map(({ userId }) => userId));
          // 입력의 최초 명단은 의도만 알려 준다. 새 삽입 자격은 서버의 잠금 아래 검사를 통과한 ID만 가진다.
          const approvedNewIds = participants
            .filter(({ userId }) => !currentIds.includes(userId))
            .map(({ userId }) => userId);
          const addedIds = approvedNewIds.filter(
            (id) => !latestIds.includes(id),
          );
          const removedIds = latestIds.filter((id) => !desiredIds.has(id));
          const retainedIds = latestIds.filter((id) => desiredIds.has(id));
          const finalIds = [...retainedIds, ...addedIds];
          await removeBookingParticipants(locked.id, removedIds, transaction);
          await insertBookingParticipants(
            locked.id,
            addedIds,
            now,
            transaction,
          );
          if (timeChanged)
            await deleteBookingReminders({ bookingId: locked.id }, transaction);
          else if (removedIds.length)
            await deleteBookingReminders(
              { bookingId: locked.id, userIds: removedIds },
              transaction,
            );
          const previous = notificationBookingSnapshot({
            booking: locked,
            space: current,
            floor: current.floor,
            branch,
          });
          const next = notificationBookingSnapshot({
            booking: updated,
            space: current,
            floor: current.floor,
            branch,
          });
          const actor = { id: session.userId, name: session.name };
          await insertNotifications(
            [
              ...buildBookingNotifications({
                type: "booking_invited",
                booking: next,
                actor,
                userIds: addedIds,
                now,
              }),
              ...buildBookingNotifications({
                type: "booking_removed",
                booking: previous,
                actor,
                userIds: removedIds,
                now,
              }),
              ...(timeChanged
                ? buildBookingNotifications({
                    type: "booking_changed",
                    booking: next,
                    actor,
                    userIds: retainedIds,
                    now,
                    previousDuring: locked.during,
                  })
                : []),
              ...buildReminderNotifications(
                next,
                timeChanged ? [session.userId, ...finalIds] : addedIds,
                now,
              ),
            ],
            transaction,
          );
          const names = await readUserNames(
            [...addedIds, ...removedIds],
            transaction,
          );
          const snapshots: SystemMessageData[] = [
            ...(timeChanged
              ? [
                  {
                    type: "booking_time_changed" as const,
                    actorName: session.name,
                    timezone: branch.timezone,
                    previousStart: locked.during.start.toISOString(),
                    previousEnd: locked.during.end.toISOString(),
                    start: updated.during.start.toISOString(),
                    end: updated.during.end.toISOString(),
                  },
                ]
              : []),
            ...(addedIds.length
              ? [
                  {
                    type: "participants_added" as const,
                    actorName: session.name,
                    names: names
                      .filter(({ id }) => addedIds.includes(id))
                      .map(({ name }) => name),
                  },
                ]
              : []),
            ...(removedIds.length
              ? [
                  {
                    type: "participant_removed" as const,
                    actorName: session.name,
                    names: names
                      .filter(({ id }) => removedIds.includes(id))
                      .map(({ name }) => name),
                  },
                ]
              : []),
          ];
          const chatEvents = await recordMeetingMessages(
            {
              bookingId: updated.id,
              actorId: session.userId,
              memberIds: [session.userId, ...finalIds],
              removedUserIds: removedIds,
              messages: snapshots,
              changed:
                snapshots.length > 0 ||
                locked.title !== updated.title ||
                locked.attendeeCount !== updated.attendeeCount,
              now,
            },
            transaction,
          );
          return {
            bookingId: updated.id,
            removedIds,
            floorId: current.floor.id,
            spaceId: current.id,
            chatEvents,
          };
        }, db);
        await evictBookingCalls(result.removedIds, dependencies);
        await publishBookingChange(
          result.floorId,
          result.spaceId,
          dependencies,
        );
        await publishBookingChatEvents(result.chatEvents, dependencies);
        return { bookingId: result.bookingId };
      },
    },
    bookingActionDependencies(dependencies),
  );
}
