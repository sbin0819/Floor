import {
  actionDependencies,
  canManageTeam,
  type TeamActionDependencies,
} from "@/features/teams/action-factory";
import { inviteIdSchema, sendInviteSchema } from "@/features/teams/schema";
import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import {
  createTeamInvite,
  getTeamIdentity,
  getTeamInviteById,
  revokeTeamInvite,
} from "@/lib/dal";
import { getEmailSender, type EmailSender } from "@/lib/email";
import { teamInviteEmail } from "@/lib/email/templates";
import { getEnv } from "@/lib/env";

export type TeamInviteDependencies = TeamActionDependencies & {
  email?: EmailSender;
  appUrl?: string;
  logEmailFailure?: () => void;
};

export function createInviteManagementActions(
  dependencies: TeamInviteDependencies = {},
) {
  const database = dependencies.database;
  const wrapper = actionDependencies(dependencies);
  return {
    sendTeamInvite: createAction(
      {
        input: sendInviteSchema,
        authorize: async ({ session, input }) => {
          const team = await getTeamIdentity(input.teamId, database);
          if (!team) throw new ActionError("NOT_FOUND");
          return canManageTeam(session, team.id, database);
        },
        handler: async ({ session, input }) => {
          const invite = await createTeamInvite(
            { ...input, actorUserId: session.userId },
            database,
          );
          // DAL의 트랜잭션이 성공한 뒤에만 외부 메일 구현을 호출한다.
          try {
            const url = new URL(
              `/invite/${encodeURIComponent(invite.token)}`,
              dependencies.appUrl ?? getEnv().NEXT_PUBLIC_APP_URL,
            ).href;
            await (dependencies.email ?? getEmailSender()).send(
              teamInviteEmail({
                to: invite.email,
                teamName: invite.teamName,
                senderName: invite.senderName,
                message: invite.message,
                url,
                expiresAt: invite.expiresAt,
              }),
            );
          } catch {
            try {
              if (dependencies.logEmailFailure) dependencies.logEmailFailure();
              else console.error("[teams] Invitation email delivery failed.");
            } catch {
              // 메일과 로깅 실패가 이미 커밋된 초대의 성공 결과를 뒤집지 않게 한다.
            }
          }
          return { inviteId: invite.id };
        },
      },
      wrapper,
    ),
    revokeTeamInvite: createAction(
      {
        input: inviteIdSchema,
        authorize: async ({ session, input }) => {
          const invite = await getTeamInviteById(input.inviteId, database);
          if (
            !invite ||
            invite.acceptedAt ||
            invite.declinedAt ||
            invite.revokedAt
          )
            throw new ActionError("INVITE_INVALID");
          return canManageTeam(session, invite.teamId, database);
        },
        handler: ({ session, input }) =>
          revokeTeamInvite(
            { inviteId: input.inviteId, actorUserId: session.userId },
            database,
          ),
      },
      wrapper,
    ),
  };
}
