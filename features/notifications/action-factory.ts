import { z } from "zod";
import {
  createAction,
  type ActionDependencies,
} from "@/lib/actions/create-action";
import type { DalDatabase } from "@/lib/dal";
import {
  markAllVisibleNotificationsRead,
  markVisibleNotificationRead,
} from "@/lib/dal/notifications-read";

type Dependencies = Partial<ActionDependencies> & {
  database?: DalDatabase;
  now?: () => Date;
};

export function createNotificationActions(dependencies: Dependencies = {}) {
  const actionDependencies = {
    ...(dependencies.getSession ? { getSession: dependencies.getSession } : {}),
    ...(dependencies.logError ? { logError: dependencies.logError } : {}),
  };
  const markNotificationRead = createAction(
    {
      input: z.strictObject({ notificationId: z.uuid() }),
      authorize: "none",
      handler: async ({ input, session }) => {
        await markVisibleNotificationRead(
          session.userId,
          input.notificationId,
          dependencies.now?.() ?? new Date(),
          dependencies.database,
        );
        return {};
      },
    },
    actionDependencies,
  );
  const markAll = createAction(
    {
      input: z.undefined(),
      authorize: "none",
      handler: async ({ session }) => {
        await markAllVisibleNotificationsRead(
          session.userId,
          dependencies.now?.() ?? new Date(),
          dependencies.database,
        );
        return {};
      },
    },
    actionDependencies,
  );
  return {
    markNotificationRead,
    markAllNotificationsRead: () => markAll(undefined),
  };
}
