import { createTeamSchema } from "@/features/teams/schema";
import {
  actionDependencies,
  type TeamActionDependencies,
} from "@/features/teams/action-factory";
import { createAction } from "@/lib/actions/create-action";
import { createTeam } from "@/lib/dal";

export function createTeamActions(dependencies: TeamActionDependencies = {}) {
  return {
    createTeam: createAction(
      {
        input: createTeamSchema,
        authorize: "none",
        handler: ({ session, input }) =>
          createTeam(
            { ...input, userId: session.userId },
            dependencies.database,
          ),
      },
      actionDependencies(dependencies),
    ),
  };
}
