import { z } from "zod";
import {
  createAction,
  type ActionDependencies,
} from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import {
  withTransaction,
  type DalDatabase,
  type TransactionDatabase,
} from "@/lib/dal/database";
import { saveUserStatus } from "@/lib/dal/people-status";
import { getRealtimePublisher } from "@/lib/realtime/server";
import { userChannel } from "@/lib/realtime/channels";
import type { RealtimePublisher } from "@/lib/realtime/types";
import { userStatusSchema } from "./status";

export function createStatusAction(
  dependencies: Partial<ActionDependencies> & {
    database?: DalDatabase & TransactionDatabase;
    now?: () => Date;
    publisher?: RealtimePublisher;
  } = {},
) {
  return createAction(
    {
      input: z.strictObject({ status: userStatusSchema }),
      authorize: "none",
      async handler({ session, input }) {
        const now = dependencies.now?.() ?? new Date();
        const result = await withTransaction(async (tx) => {
          const saved = await saveUserStatus(
            session.userId,
            input.status,
            now,
            tx,
          );
          if (!saved) throw new ActionError("NOT_FOUND");
          return saved;
        }, dependencies.database);
        try {
          await (dependencies.publisher ?? getRealtimePublisher()).publish(
            userChannel(session.userId),
            { type: "status.changed", status: result.status },
          );
        } catch {
          console.error("Status update publication failed.");
        }
        return result;
      },
    },
    dependencies,
  );
}
