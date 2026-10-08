import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { withTransaction } from "@/lib/dal";
import {
  assertTeamHomeBranch,
  countManagedTeams,
  getTeamChatSpace,
  lockFirstTeamTextChannel,
  lockTeamChatSpace,
  updateMemberRole,
  updateMemberTitle,
  updateTeamRecord,
} from "@/lib/dal/teams-manage";
import { insertSystemMessage } from "@/lib/dal/chat-write";
import { insertNotifications } from "@/lib/dal/notifications";
import { roomChannel, spaceChannel } from "@/lib/realtime/channels";
import type { RealtimeItem } from "@/lib/realtime/types";
import { buildTeamNotifications } from "@/features/notifications/builders";
import { actionDependencies } from "./action-factory";
import {
  setMemberRoleSchema,
  setMemberTitleSchema,
  updateTeamSchema,
} from "./manage-schema";
import {
  authorizeManagedTeam,
  lockManagedTeam,
  publishTeamEvents,
  teamNotificationsChanged,
  type TeamManagementDependencies,
} from "./manage-support";

export function createTeamInfoActions(
  dependencies: TeamManagementDependencies = {},
) {
  const wrapper = actionDependencies(dependencies);
  const clock = dependencies.now ?? (() => new Date());
  return {
    updateTeam: createAction(
      {
        input: updateTeamSchema,
        authorize: ({ session, input }) =>
          authorizeManagedTeam(
            session.userId,
            input.teamId,
            true,
            dependencies.database,
          ),
        async handler({ session, input }) {
          const now = clock();
          const events = await withTransaction(async (tx) => {
            const { team } = await lockManagedTeam(
              {
                actorId: session.userId,
                teamId: input.teamId,
                manager: true,
                users: [{ userId: session.userId, strength: "update" }],
              },
              tx,
            );
            await assertTeamHomeBranch(input.homeBranchId, tx);
            const { teamId, ...values } = input;
            await updateTeamRecord(teamId, values, tx);
            const events: RealtimeItem[] = [];
            if (team.name !== input.name) {
              const space = await lockTeamChatSpace(team.id, tx);
              if (space) {
                const room = await lockFirstTeamTextChannel(space.id, tx);
                if (room) {
                  const message = await insertSystemMessage(
                    {
                      roomId: room.id,
                      actorId: session.userId,
                      data: {
                        type: "team_renamed",
                        actorName: session.name,
                        name: input.name,
                      },
                      now,
                    },
                    tx,
                  );
                  events.push({
                    channel: roomChannel(room.id),
                    event: {
                      type: "message.created",
                      roomId: room.id,
                      ...message,
                      editedAt: null,
                      deletedAt: null,
                      reactions: [],
                    },
                  });
                  events.push({
                    channel: spaceChannel(space.id),
                    event: {
                      type: "room.activity",
                      spaceId: space.id,
                      roomId: room.id,
                      roomKind: "text",
                      bookingId: null,
                      seq: message.seq,
                      authorId: null,
                      preview: null,
                    },
                  });
                }
                events.push({
                  channel: spaceChannel(space.id),
                  event: { type: "space.changed", spaceId: space.id },
                });
              }
            }
            return events;
          }, dependencies.database);
          await publishTeamEvents(events, dependencies);
          return { teamId: input.teamId };
        },
      },
      wrapper,
    ),
    setMemberRole: createAction(
      {
        input: setMemberRoleSchema,
        authorize: ({ session, input }) =>
          authorizeManagedTeam(
            session.userId,
            input.teamId,
            true,
            dependencies.database,
          ),
        async handler({ session, input }) {
          const now = clock();
          const events = await withTransaction(async (tx) => {
            const { team, members } = await lockManagedTeam(
              {
                actorId: session.userId,
                teamId: input.teamId,
                manager: true,
                users: [
                  { userId: session.userId, strength: "update" },
                  {
                    userId: input.userId,
                    strength: input.role === "admin" ? "update" : "key share",
                  },
                ],
              },
              tx,
            );
            const member = members.find(
              ({ userId }) => userId === input.userId,
            );
            if (!member) throw new ActionError("NOT_FOUND");
            if (member.role === input.role) return [];
            if (
              input.role === "member" &&
              members.filter(({ role }) => role === "admin").length === 1
            )
              throw new ActionError("LAST_ADMIN");
            if (
              input.role === "admin" &&
              (await countManagedTeams(input.userId, tx)) >= 5
            )
              throw new ActionError("LIMIT_EXCEEDED", {
                message: "admin_teams",
              });
            await updateMemberRole({ ...input, from: member.role }, tx);
            const notifications = buildTeamNotifications({
              type: "team_role_changed",
              teamId: team.id,
              teamName: team.name,
              role: input.role,
              actor: { id: session.userId, name: session.name },
              userIds: [input.userId],
              now,
            });
            await insertNotifications(notifications, tx);
            const space = await getTeamChatSpace(team.id, tx);
            return [
              ...teamNotificationsChanged(
                notifications.map(({ userId }) => userId),
              ),
              ...(space
                ? [
                    {
                      channel: spaceChannel(space.id),
                      event: {
                        type: "space.changed" as const,
                        spaceId: space.id,
                      },
                    },
                  ]
                : []),
            ];
          }, dependencies.database);
          await publishTeamEvents(events, dependencies);
          return { teamId: input.teamId };
        },
      },
      wrapper,
    ),
    setMemberTitle: createAction(
      {
        input: setMemberTitleSchema,
        authorize: ({ session, input }) =>
          authorizeManagedTeam(
            session.userId,
            input.teamId,
            input.userId !== session.userId,
            dependencies.database,
          ),
        async handler({ session, input }) {
          await withTransaction(async (tx) => {
            const { members } = await lockManagedTeam(
              {
                actorId: session.userId,
                teamId: input.teamId,
                manager: input.userId !== session.userId,
                users: [
                  { userId: session.userId, strength: "update" },
                  { userId: input.userId, strength: "key share" },
                ],
              },
              tx,
            );
            if (!members.some(({ userId }) => userId === input.userId))
              throw new ActionError("NOT_FOUND");
            await updateMemberTitle(input, tx);
          }, dependencies.database);
          return { teamId: input.teamId };
        },
      },
      wrapper,
    ),
  };
}
