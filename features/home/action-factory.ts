import { z } from "zod";
import {
  createAction,
  type ActionDependencies,
} from "@/lib/actions/create-action";
import type { DalDatabase } from "@/lib/dal/database";
import { dismissHomeChecklist } from "@/lib/dal/home";

export type HomeActionDependencies = Partial<ActionDependencies> & {
  database?: DalDatabase;
  now?: () => Date;
};

export function createHomeActions(dependencies: HomeActionDependencies = {}) {
  return {
    dismissHomeChecklist: createAction(
      {
        input: z.strictObject({}),
        authorize: "none",
        async handler({ session }) {
          await dismissHomeChecklist(
            session.userId,
            dependencies.now?.() ?? new Date(),
            dependencies.database,
          );
          return {};
        },
      },
      dependencies,
    ),
  };
}
