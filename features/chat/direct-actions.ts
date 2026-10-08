import { z } from "zod";
import { createAction } from "@/lib/actions/create-action";
import { evictCalls } from "@/lib/calls/evict";
import { ActionError } from "@/lib/actions/result";
import { createDirectRoom, directPeerAccess } from "@/lib/dal/direct";
import { lockUsersForKeyShare } from "@/lib/dal/chat-write";
import { withTransaction } from "@/lib/dal/database";
import type { ChatActionDependencies } from "./action-factory";
import { canReadRoom } from "@/lib/dal/chat-access";
import { lockRoomForMessage, lockRoomMembers } from "@/lib/dal/chat-write";
import {
  changeDirectMember,
  deleteMessageRequestNotification,
} from "@/lib/dal/direct-requests";
import { roomChannel, userChannel } from "@/lib/realtime/channels";
import { getRealtimePublisher } from "@/lib/realtime/server";
import type { RealtimeItem } from "@/lib/realtime/types";

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
            const room = await createDirectRoom(
              [session.userId, input.userId],
              now,
              tx,
            );
            const members = await lockRoomMembers(room.roomId, tx);
            const mine = members.find(
              (member) => member.userId === session.userId,
            );
            if (mine?.status === "declined")
              await changeDirectMember(
                {
                  roomId: room.roomId,
                  userId: session.userId,
                  from: "declined",
                  status: "active",
                  now,
                },
                tx,
              );
            return room;
          }, dependencies.database);
        },
      },
      dependencies,
    ),
    respondMessageRequest: createAction(
      {
        input: z.strictObject({ roomId: z.uuid(), accept: z.boolean() }),
        authorize: "none",
        async handler({ session, input }) {
          const room = await canReadRoom(
            session.userId,
            input.roomId,
            dependencies.database,
          );
          if (!room || room.kind !== "dm" || !room.peer)
            throw new ActionError("NOT_FOUND");
          const peerId = room.peer.userId;
          const now = dependencies.now?.() ?? new Date();
          await withTransaction(async (tx) => {
            await lockUsersForKeyShare([session.userId, peerId], tx);
            await lockRoomForMessage(input.roomId, tx);
            const members = await lockRoomMembers(input.roomId, tx);
            if (
              members.find((member) => member.userId === session.userId)
                ?.status !== "requested"
            )
              throw new ActionError("NOT_FOUND");
            const changed = await changeDirectMember(
              {
                roomId: input.roomId,
                userId: session.userId,
                from: "requested",
                status: input.accept ? "active" : "declined",
                now,
              },
              tx,
            );
            if (!changed.length) throw new ActionError("NOT_FOUND");
            await deleteMessageRequestNotification(session.userId, peerId, tx);
          }, dependencies.database);
          if (!input.accept)
            await Promise.all(
              [session.userId, peerId].map((userId) =>
                evictCalls(userId, dependencies),
              ),
            );
          const events: RealtimeItem[] = [
            {
              channel: userChannel(session.userId),
              event: { type: "notifications.changed" },
            },
          ];
          if (input.accept)
            events.push(
              {
                channel: roomChannel(input.roomId),
                event: { type: "room.changed", roomId: input.roomId },
              },
              {
                channel: userChannel(peerId),
                event: { type: "friend.changed" },
              },
            );
          else
            events.push({
              channel: userChannel(session.userId),
              event: { type: "realtime.reauth" },
            });
          try {
            await (
              dependencies.publisher ?? getRealtimePublisher()
            ).publishMany(events);
          } catch {
            (dependencies.logError ?? console.error)(
              "Chat realtime publication failed.",
            );
          }
          return {};
        },
      },
      dependencies,
    ),
  };
}
