import { z } from "zod";
import { getLiveKitServer } from "@/lib/calls/livekit-server";
import { readCallParticipant, readCallRoom } from "@/lib/dal/call-read";
import { confirmCallParticipant } from "@/lib/dal/call-webhook";
import { withTransaction } from "@/lib/dal/database";
import { getRealtimePublisher } from "@/lib/realtime/server";
import { createCallService, type CallDependencies } from "./service";

const uuid = z.uuid();
const response = (status: number) =>
  new Response(null, { status, headers: { "Cache-Control": "no-store" } });

export function createCallWebhookHandler(dependencies: CallDependencies = {}) {
  return async (request: Request) => {
    const livekit =
      dependencies.livekit === undefined
        ? getLiveKitServer()
        : dependencies.livekit;
    if (!livekit) return response(404);
    let event;
    try {
      event = await livekit.verifyWebhook(
        await request.text(),
        request.headers.get("Authorization") ?? "",
      );
    } catch {
      return response(401);
    }
    if (
      event.event !== "participant_joined" &&
      event.event !== "participant_left"
    )
      return response(200);
    const roomId = event.roomName?.startsWith("call:")
      ? event.roomName.slice(5)
      : "";
    if (!uuid.safeParse(roomId).success || !event.participant)
      return response(200);
    try {
      const room = await withTransaction(
        (tx) => readCallRoom(roomId, tx),
        dependencies.database,
      );
      if (!room) return response(200);
      const { identity, attributes } = event.participant;
      const validIdentity =
        uuid.safeParse(identity).success &&
        identity === attributes.participantId &&
        uuid.safeParse(attributes.userId).success;
      const participant = validIdentity
        ? await readCallParticipant(identity, dependencies.database)
        : null;
      const matches =
        participant !== null &&
        participant.roomId === roomId &&
        participant.userId === attributes.userId;
      if (event.event === "participant_joined") {
        const result =
          matches &&
          (await confirmCallParticipant(
            {
              participantId: identity,
              userId: participant.userId,
              roomId,
              now: dependencies.now?.() ?? new Date(),
            },
            dependencies.database,
          ));
        if (result && result.events.length) {
          try {
            await (
              dependencies.publisher ?? getRealtimePublisher()
            ).publishMany(result.events);
          } catch {
            (dependencies.logError ?? console.error)(
              "Call realtime publication failed.",
            );
          }
        }
        if ((!result || !result.confirmed) && identity) {
          try {
            await livekit.removeParticipant(event.roomName!, identity);
          } catch {
            (dependencies.logError ?? console.error)(
              "Call participant removal failed.",
            );
          }
        }
      } else if (matches) {
        await createCallService({ ...dependencies, livekit }).leave({
          userId: participant.userId,
          participantId: identity,
        });
      }
      return response(200);
    } catch {
      (dependencies.logError ?? console.error)(
        "Call webhook processing failed.",
      );
      return response(500);
    }
  };
}
