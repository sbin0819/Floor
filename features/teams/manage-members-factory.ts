import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import {
  listFutureTeamBookings,
  lockFutureTeamBookingRows,
} from "@/lib/dal/team-bookings";
import { lockTeamChatSpace, removeTeamMember } from "@/lib/dal/teams-manage";
import { insertNotifications } from "@/lib/dal/notifications";
import { buildTeamNotifications } from "@/features/notifications/builders";
import {
  assertParticipantsLocked,
  withParticipantTransaction,
} from "@/features/bookings/participant-transaction";
import { actionDependencies } from "./action-factory";
import { managedMemberSchema, managedTeamSchema } from "./manage-schema";
import { authorizeManagedTeam, lockManagedTeam } from "./manage-support";
import {
  cancelFutureTeamBookings,
  futureTeamBookingUsers,
} from "./manage-booking-cancellation";
import {
  publishTeamRemovalEffects,
  type TeamRemovalDependencies,
} from "./manage-effects";
import type { Session } from "@/lib/auth/types";

export function createTeamMemberActions(
  dependencies: TeamRemovalDependencies = {},
) {
  const wrapper = actionDependencies(dependencies);
  async function remove(
    session: Session,
    teamId: string,
    userId: string,
    leaving: boolean,
  ) {
    if (!leaving && session.userId === userId)
      throw new ActionError("INVALID_INPUT");
    const now = dependencies.now?.() ?? new Date();
    const result = await withParticipantTransaction(async (tx) => {
      const scope = { teamId, userId, now };
      const before = await listFutureTeamBookings(scope, tx);
      const lockedUserIds = [
        ...new Set([session.userId, userId, ...futureTeamBookingUsers(before)]),
      ];
      const { team, members } = await lockManagedTeam(
        {
          actorId: session.userId,
          teamId,
          manager: !leaving,
          users: lockedUserIds.map((id) => ({
            userId: id,
            strength: id === session.userId ? "update" : "key share",
          })),
        },
        tx,
      );
      const member = members.find((row) => row.userId === userId);
      if (!member) throw new ActionError("NOT_FOUND");
      if (
        member.role === "admin" &&
        members.filter(({ role }) => role === "admin").length === 1
      )
        throw new ActionError("LAST_ADMIN");
      if (leaving && members.length === 1) throw new ActionError("LAST_ADMIN");
      assertParticipantsLocked(
        lockedUserIds,
        futureTeamBookingUsers(await listFutureTeamBookings(scope, tx)),
      );
      await removeTeamMember(teamId, userId, tx);
      await lockFutureTeamBookingRows(scope, tx);
      const bookings = await listFutureTeamBookings(scope, tx);
      assertParticipantsLocked(lockedUserIds, futureTeamBookingUsers(bookings));
      const space = await lockTeamChatSpace(teamId, tx);
      const actor = { id: session.userId, name: session.name };
      const cancelled = await cancelFutureTeamBookings(
        { bookings, actor, now, lockedUserIds },
        tx,
      );
      const notifications = leaving
        ? []
        : buildTeamNotifications({
            type: "team_removed",
            teamName: team.name,
            actor,
            userIds: [userId],
            now,
          });
      await insertNotifications(notifications, tx);
      return {
        removedUserIds: [userId],
        spaceId: space?.id ?? null,
        bookings: cancelled,
        notificationUserIds: notifications.map(({ userId }) => userId),
      };
    }, dependencies.database);
    await publishTeamRemovalEffects(result, dependencies);
    return { teamId };
  }
  return {
    removeMember: createAction(
      {
        input: managedMemberSchema,
        authorize: ({ session, input }) =>
          authorizeManagedTeam(
            session.userId,
            input.teamId,
            true,
            dependencies.database,
          ),
        handler: ({ session, input }) =>
          remove(session, input.teamId, input.userId, false),
      },
      wrapper,
    ),
    leaveTeam: createAction(
      {
        input: managedTeamSchema,
        authorize: ({ session, input }) =>
          authorizeManagedTeam(
            session.userId,
            input.teamId,
            false,
            dependencies.database,
          ),
        handler: ({ session, input }) =>
          remove(session, input.teamId, session.userId, true),
      },
      wrapper,
    ),
  };
}
