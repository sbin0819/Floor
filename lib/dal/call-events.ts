import "server-only";

import type { ChatMessage } from "@/features/chat/types";
import {
  roomChannel,
  spaceChannel,
  userChannel,
} from "@/lib/realtime/channels";
import type { RealtimeEvent, RealtimeItem } from "@/lib/realtime/types";
import type { DalDatabase } from "./database";
import {
  readActiveCallPeople,
  readCallAudience,
  readCallRoom,
  readOpenCall,
} from "./call-read";

export async function callEvents(
  roomId: string,
  now: Date,
  messages: readonly ChatMessage[],
  database: DalDatabase,
): Promise<RealtimeItem[]> {
  const room = await readCallRoom(roomId, database);
  if (!room) return [];
  const session = await readOpenCall(roomId, database);
  const people = session
    ? await readActiveCallPeople(session.id, now, database)
    : [];
  const audience = room.spaceId ? [] : await readCallAudience(roomId, database);
  const targets = room.spaceId
    ? [spaceChannel(room.spaceId)]
    : audience.map(userChannel);
  const changed: RealtimeEvent = {
    type: "call.changed",
    roomId,
    roomKind: room.kind,
    spaceId: room.spaceId,
    bookingId: room.bookingId,
    sessionId: session?.id ?? null,
    kind: session?.kind ?? null,
    participantCount: people.length,
    participants: room.spaceKind === "branch" ? [] : people,
  };
  return [
    ...[roomChannel(roomId), ...targets].map((channel) => ({
      channel,
      event: changed,
    })),
    ...messages.flatMap((message): RealtimeItem[] => [
      {
        channel: roomChannel(roomId),
        event: {
          type: "message.created",
          roomId,
          ...message,
          editedAt: null,
          deletedAt: null,
          reactions: [],
        },
      },
      ...targets.map((channel): RealtimeItem => ({
        channel,
        event: {
          type: "room.activity",
          roomId,
          roomKind: room.kind,
          spaceId: room.spaceId,
          bookingId: room.bookingId,
          seq: message.seq,
          authorId: null,
          preview: room.spaceId
            ? null
            : {
                messageId: message.id,
                authorName: null,
                excerpt: message.body,
              },
        },
      })),
    ]),
  ];
}
