import "server-only";

import { and, asc, eq, inArray } from "drizzle-orm";
import { ActionError } from "@/lib/actions/result";
import { chatRooms, users } from "@/lib/db/schema";
import type { SystemMessageData } from "@/features/chat/system-messages";
import type { ChatMessage } from "@/features/chat/types";
import { roomChannel, userChannel } from "@/lib/realtime/channels";
import type { RealtimeItem } from "@/lib/realtime/types";
import type { DalDatabase } from "./database";
import { insertSystemMessage, lockRoomForMessage } from "./chat-write";

export async function createMeetingRoom(
  input: { bookingId: string; now: Date },
  database: DalDatabase,
) {
  const [room] = await database
    .insert(chatRooms)
    .values({
      kind: "meeting",
      bookingId: input.bookingId,
      createdAt: input.now,
    })
    .returning({ id: chatRooms.id });
  if (!room) throw new ActionError("INTERNAL");
  await lockRoomForMessage(room.id, database);
  return room;
}

export async function lockMeetingRoom(
  bookingId: string,
  database: DalDatabase,
) {
  const [room] = await database
    .select({ id: chatRooms.id })
    .from(chatRooms)
    .where(
      and(eq(chatRooms.bookingId, bookingId), eq(chatRooms.kind, "meeting")),
    )
    .for("update");
  return room ?? null;
}

export async function readUserNames(
  ids: readonly string[],
  database: DalDatabase,
) {
  if (!ids.length) return [];
  return database
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [...new Set(ids)]))
    .orderBy(asc(users.name), asc(users.id));
}

// 예약 쪽의 잠금·쓰기가 끝난 뒤에만 부른다. 재시도 중인 이벤트를 외부 배열에 쌓지 않는다.
export async function recordMeetingMessages(
  input: {
    bookingId: string;
    actorId: string | null;
    memberIds: readonly string[];
    removedUserIds?: readonly string[];
    messages: readonly SystemMessageData[];
    changed: boolean;
    now: Date;
  },
  database: DalDatabase,
  createdRoom?: { id: string },
): Promise<RealtimeItem[]> {
  const room =
    createdRoom ?? (await lockMeetingRoom(input.bookingId, database));
  if (!room) return [];
  const messages: ChatMessage[] = [];
  for (const data of input.messages)
    messages.push(
      await insertSystemMessage(
        { roomId: room.id, actorId: input.actorId, data, now: input.now },
        database,
      ),
    );
  const recipients = [...new Set(input.memberIds)].filter(
    (id) => id !== input.actorId,
  );
  return [
    ...[...new Set(input.removedUserIds ?? [])].map((id) => ({
      channel: userChannel(id),
      event: { type: "realtime.reauth" as const },
    })),
    ...messages.map((message): RealtimeItem => ({
      channel: roomChannel(room.id),
      event: {
        type: "message.created",
        roomId: room.id,
        ...message,
        editedAt: null,
        deletedAt: null,
        reactions: [],
      },
    })),
    ...messages.flatMap((message) =>
      recipients.map((id): RealtimeItem => ({
        channel: userChannel(id),
        event: {
          type: "room.activity",
          roomKind: "meeting",
          spaceId: null,
          bookingId: input.bookingId,
          roomId: room.id,
          seq: message.seq,
          authorId: null,
          preview: {
            messageId: message.id,
            authorName: null,
            excerpt: message.body,
          },
        },
      })),
    ),
    ...(input.changed
      ? [
          {
            channel: roomChannel(room.id),
            event: { type: "room.changed" as const, roomId: room.id },
          },
        ]
      : []),
  ];
}
