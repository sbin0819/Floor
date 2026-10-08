import { z } from "zod";
import { createAction } from "@/lib/actions/create-action";
import { createCallService, type CallDependencies } from "./service";

export function createCallActions(dependencies: CallDependencies = {}) {
  const service = createCallService(dependencies);
  return {
    joinCall: createAction(
      {
        input: z.strictObject({
          roomId: z.uuid().transform((id) => id.toLowerCase()),
        }),
        authorize: "none",
        handler: ({ session, input }) => service.join(session, input.roomId),
      },
      dependencies,
    ),
    declineCall: createAction(
      {
        input: z.strictObject({
          sessionId: z.uuid().transform((id) => id.toLowerCase()),
        }),
        authorize: "none",
        handler: ({ session, input }) =>
          service.decline(session, input.sessionId),
      },
      dependencies,
    ),
  };
}
