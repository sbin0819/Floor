import {
  actionDependencies,
  canManageTeam,
  type TeamActionDependencies,
} from "@/features/teams/action-factory";
import {
  createJoinRequestSchema,
  requestIdSchema,
} from "@/features/teams/schema";
import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import {
  approveJoinRequest,
  cancelJoinRequest,
  createJoinRequest,
  getJoinRequestById,
  rejectJoinRequest,
} from "@/lib/dal";
import type { Session } from "@/lib/auth/types";

export function createJoinRequestActions(
  dependencies: TeamActionDependencies = {},
) {
  const database = dependencies.database;
  const wrapper = actionDependencies(dependencies);
  async function authorizeDecision({
    session,
    input,
  }: {
    session: Session;
    input: { requestId: string };
  }) {
    const request = await getJoinRequestById(input.requestId, database);
    if (!request || request.status !== "pending")
      throw new ActionError("NOT_FOUND");
    return canManageTeam(session, request.teamId, database);
  }
  return {
    requestTeamJoin: createAction(
      {
        input: createJoinRequestSchema,
        authorize: "none",
        handler: ({ session, input }) =>
          createJoinRequest({ ...input, userId: session.userId }, database),
      },
      wrapper,
    ),
    cancelTeamJoinRequest: createAction(
      {
        input: requestIdSchema,
        authorize: "none",
        handler: ({ session, input }) =>
          cancelJoinRequest(
            { requestId: input.requestId, userId: session.userId },
            database,
          ),
      },
      wrapper,
    ),
    approveTeamJoinRequest: createAction(
      {
        input: requestIdSchema,
        authorize: authorizeDecision,
        handler: ({ session, input }) =>
          approveJoinRequest(
            { requestId: input.requestId, actorUserId: session.userId },
            database,
          ),
      },
      wrapper,
    ),
    rejectTeamJoinRequest: createAction(
      {
        input: requestIdSchema,
        authorize: authorizeDecision,
        handler: ({ session, input }) =>
          rejectJoinRequest(
            { requestId: input.requestId, actorUserId: session.userId },
            database,
          ),
      },
      wrapper,
    ),
  };
}
