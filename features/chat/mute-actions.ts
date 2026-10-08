import { z } from "zod";
import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { canReadRoom, canReadSpace } from "@/lib/dal/chat-access";
import { saveRoomMuted, saveSpaceMuted } from "@/lib/dal/chat-reads";
import type { ChatActionDependencies } from "./action-factory";

export function createMuteActions(dependencies: ChatActionDependencies) {
  return {
    setRoomMuted: createAction(
      {
        input: z.strictObject({ roomId: z.uuid(), muted: z.boolean() }),
        authorize: "none",
        async handler({ session, input }) {
          if (
            !(await canReadRoom(
              session.userId,
              input.roomId,
              dependencies.database,
            ))
          )
            throw new ActionError("NOT_FOUND");
          const saved = await saveRoomMuted(
            {
              ...input,
              userId: session.userId,
              now: dependencies.now?.() ?? new Date(),
            },
            dependencies.database,
          );
          if (!saved) throw new ActionError("NOT_FOUND");
          return saved;
        },
      },
      dependencies,
    ),
    setSpaceMuted: createAction(
      {
        input: z.strictObject({ spaceId: z.uuid(), muted: z.boolean() }),
        authorize: "none",
        async handler({ session, input }) {
          if (
            !(await canReadSpace(
              session.userId,
              input.spaceId,
              dependencies.database,
            ))
          )
            throw new ActionError("NOT_FOUND");
          const saved = await saveSpaceMuted(
            {
              ...input,
              userId: session.userId,
              now: dependencies.now?.() ?? new Date(),
            },
            dependencies.database,
          );
          if (!saved) throw new ActionError("NOT_FOUND");
          return saved;
        },
      },
      dependencies,
    ),
  };
}
