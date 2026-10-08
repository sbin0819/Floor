import { z } from "zod";
import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { createDirectRoom, directPeerAccess } from "@/lib/dal/direct";
import { lockUsersForKeyShare } from "@/lib/dal/chat-write";
import { withTransaction } from "@/lib/dal/database";
import type { ChatActionDependencies } from "./action-factory";

export function createDirectActions(dependencies: ChatActionDependencies = {}) {
  return {
    openDirectMessage: createAction(
      {
        input: z.strictObject({
          userId: z.uuid().transform((id) => id.toLowerCase()),
        }),
        authorize: "none",
        async handler({ session, input }) {
          if (session.userId === input.userId.toLowerCase())
            throw new ActionError("INVALID_INPUT");
          const now = dependencies.now?.() ?? new Date();
          return withTransaction(async (tx) => {
            await lockUsersForKeyShare([session.userId, input.userId], tx);
            const access = await directPeerAccess(
              session.userId,
              input.userId,
              tx,
            );
            if (!access.existsVerified) throw new ActionError("NOT_FOUND");
            if (!access.canOpen) throw new ActionError("FORBIDDEN");
            return createDirectRoom([session.userId, input.userId], now, tx);
          }, dependencies.database);
        },
      },
      dependencies,
    ),
  };
}
