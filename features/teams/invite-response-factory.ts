import {
  actionDependencies,
  type TeamActionDependencies,
} from "@/features/teams/action-factory";
import { inviteTokenSchema } from "@/features/teams/schema";
import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import {
  acceptTeamInvite,
  declineTeamInvite,
  getInviteForRecipient,
  getUserById,
} from "@/lib/dal";

export function createInviteResponseActions(
  dependencies: TeamActionDependencies = {},
) {
  const database = dependencies.database;
  const wrapper = actionDependencies(dependencies);
  async function authorizeRecipient({
    session,
    input,
  }: {
    session: Session;
    input: { token: string };
  }) {
    const user = await getUserById(session.userId, database);
    if (
      !user?.emailVerified ||
      !(await getInviteForRecipient(input.token, user.email, database))
    )
      throw new ActionError("INVITE_INVALID");
    return true;
  }
  return {
    acceptTeamInvite: createAction(
      {
        input: inviteTokenSchema,
        authorize: authorizeRecipient,
        handler: ({ session, input }) =>
          acceptTeamInvite(
            { token: input.token, userId: session.userId },
            database,
          ),
      },
      wrapper,
    ),
    declineTeamInvite: createAction(
      {
        input: inviteTokenSchema,
        authorize: authorizeRecipient,
        handler: ({ session, input }) =>
          declineTeamInvite(
            { token: input.token, userId: session.userId },
            database,
          ),
      },
      wrapper,
    ),
  };
}
