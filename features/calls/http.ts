import { z } from "zod";
import type { Session } from "@/lib/auth/types";
import { getSession } from "@/lib/auth/session";
import { callsEnabled } from "@/lib/calls/livekit-server";
import { isSameOrigin } from "@/lib/http/same-origin";
import { createCallService } from "./service";

export type CallParticipantOperation = (input: {
  userId: string;
  participantId: string;
}) => Promise<boolean>;

export type CallHttpDependencies = {
  getSession: () => Promise<Session | null>;
  enabled: () => boolean;
  heartbeat: CallParticipantOperation;
  leave: CallParticipantOperation;
};

const participantInput = z.strictObject({ participantId: z.uuid() });
const respond = (status: number) =>
  new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export function createCallHttpHandlers(
  dependencies: CallHttpDependencies = {
    getSession,
    enabled: callsEnabled,
    heartbeat: (input) => createCallService().heartbeat(input),
    leave: (input) => createCallService().leave(input),
  },
) {
  const handle = async (
    request: Request,
    operation: CallParticipantOperation,
  ) => {
    try {
      const session = await dependencies.getSession();
      if (!session) return respond(401);
      if (!isSameOrigin(request)) return respond(403);
      if (!dependencies.enabled()) return respond(404);

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return respond(400);
      }
      const input = participantInput.safeParse(body);
      if (!input.success) return respond(400);

      const found = await operation({
        userId: session.userId,
        participantId: input.data.participantId,
      });
      return respond(found ? 204 : 404);
    } catch {
      console.error("Call request failed.");
      return respond(500);
    }
  };

  return {
    heartbeat: (request: Request) => handle(request, dependencies.heartbeat),
    leave: (request: Request) => handle(request, dependencies.leave),
  };
}
