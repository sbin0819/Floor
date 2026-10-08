import { requireSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";
import { ActionError } from "@/lib/actions/result";
import type { DalDatabase } from "@/lib/dal/database";
import { readHomeChecklist, readHomeTodo } from "@/lib/dal/home";
import { createHomeRecentQueries } from "./recent-query-factory";
import type { HomeChecklist, HomeTodo } from "./types";

export type HomeQueryDependencies = {
  database?: DalDatabase;
  requireSession?: () => Promise<Session>;
  now?: () => Date;
};

export function createHomeQueries(dependencies: HomeQueryDependencies = {}) {
  const session = dependencies.requireSession ?? requireSession;
  return {
    ...createHomeRecentQueries(dependencies),
    async getHomeTodo(): Promise<HomeTodo> {
      const me = await session();
      const now = dependencies.now?.() ?? new Date();
      const result = await readHomeTodo(me.userId, now, dependencies.database);
      if (!result) throw new ActionError("NOT_FOUND");
      return result;
    },
    async getHomeChecklist(): Promise<HomeChecklist> {
      const me = await session();
      const result = await readHomeChecklist(me.userId, dependencies.database);
      if (!result) throw new ActionError("NOT_FOUND");
      const { dismissedAt, isOperator, ...completed } = result;
      const steps = { emailVerified: true as const, ...completed };
      return {
        visible:
          !isOperator && !dismissedAt && !Object.values(steps).every(Boolean),
        isOperator,
        dismissedAt: dismissedAt?.toISOString() ?? null,
        steps,
      };
    },
  };
}
