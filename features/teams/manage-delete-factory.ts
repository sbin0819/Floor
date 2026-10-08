import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import {
  listFutureTeamBookings,
  lockFutureTeamBookingRows,
} from "@/lib/dal/team-bookings";
import {
  closeTeamInvitations,
  listTeamMemberUserIds,
  removeAllTeamMembers,
  removeTeamAccessGrants,
  softDeleteTeam,
  softDeleteTeamSpace,
} from "@/lib/dal/team-deletion";
import { lockTeamChatSpace } from "@/lib/dal/teams-manage";
import { insertNotifications } from "@/lib/dal/notifications";
import { buildTeamNotifications } from "@/features/notifications/builders";
import {
  assertParticipantsLocked,
  withParticipantTransaction,
} from "@/features/bookings/participant-transaction";
import { actionDependencies } from "./action-factory";
import { deleteTeamSchema } from "./manage-schema";
import { authorizeManagedTeam, lockManagedTeam } from "./manage-support";
import {
  cancelFutureTeamBookings,
  futureTeamBookingUsers,
} from "./manage-booking-cancellation";
import {
  publishTeamRemovalEffects,
  type TeamRemovalDependencies,
} from "./manage-effects";

export function createTeamDeleteActions(
  dependencies: TeamRemovalDependencies = {},
) {
  return {
    deleteTeam: createAction(
      {
        input: deleteTeamSchema,
        authorize: ({ session, input }) =>
          authorizeManagedTeam(
            session.userId,
            input.teamId,
            true,
            dependencies.database,
          ),
        async handler({ session, input }) {
          const now = dependencies.now?.() ?? new Date();
          const result = await withParticipantTransaction(async (tx) => {
            const scope = { teamId: input.teamId, now };
            const [initialMembers, initialBookings] = await Promise.all([
              listTeamMemberUserIds(input.teamId, tx),
              listFutureTeamBookings(scope, tx),
            ]);
            const lockedUserIds = [
              ...new Set([
                session.userId,
                ...initialMembers,
                ...futureTeamBookingUsers(initialBookings),
              ]),
            ];
            const { team, members } = await lockManagedTeam(
              {
                actorId: session.userId,
                teamId: input.teamId,
                manager: true,
                users: lockedUserIds.map((userId) => ({
                  userId,
                  strength: userId === session.userId ? "update" : "key share",
                })),
              },
              tx,
            );
            if (input.confirmName !== team.name)
              throw new ActionError("INVALID_INPUT");
            const removedUserIds = members.map(({ userId }) => userId);
            assertParticipantsLocked(lockedUserIds, [
              ...removedUserIds,
              ...futureTeamBookingUsers(
                await listFutureTeamBookings(scope, tx),
              ),
            ]);
            await lockFutureTeamBookingRows(scope, tx);
            const bookings = await listFutureTeamBookings(scope, tx);
            assertParticipantsLocked(
              lockedUserIds,
              futureTeamBookingUsers(bookings),
            );
            // 모든 예약을 먼저 잠근 다음 스페이스·회의 방 순서로 내려간다.
            const space = await lockTeamChatSpace(team.id, tx);
            const actor = { id: session.userId, name: session.name };
            const cancelled = await cancelFutureTeamBookings(
              { bookings, actor, now, lockedUserIds },
              tx,
            );
            await removeAllTeamMembers(team.id, tx);
            await closeTeamInvitations(
              { teamId: team.id, actorId: session.userId, now },
              tx,
            );
            const adminSpaces = await removeTeamAccessGrants(team.id, tx);
            if (space) await softDeleteTeamSpace(space.id, now, tx);
            await softDeleteTeam(
              { teamId: team.id, actorId: session.userId, now },
              tx,
            );
            const notifications = buildTeamNotifications({
              type: "team_deleted",
              teamName: team.name,
              actor,
              userIds: removedUserIds,
              now,
            });
            await insertNotifications(notifications, tx);
            return {
              removedUserIds,
              spaceId: space?.id ?? null,
              bookings: cancelled,
              notificationUserIds: notifications.map(({ userId }) => userId),
              adminSpaces,
            };
          }, dependencies.database);
          await publishTeamRemovalEffects(result, dependencies);
          return { teamId: input.teamId };
        },
      },
      actionDependencies(dependencies),
    ),
  };
}
