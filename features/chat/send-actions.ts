import { z } from "zod";
import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import { canReadRoom, canWriteRoom } from "@/lib/dal/chat-access";
import { advanceRoomRead } from "@/lib/dal/chat-reads";
import { listChatMembers } from "@/lib/dal/chat-read";
import { listMeetingMembers } from "@/lib/dal/chat-meeting-read";
import { getChatMessage } from "@/lib/dal/chat-messages";
import * as writes from "@/lib/dal/chat-write";
import { listDirectMembers } from "@/lib/dal/direct";
import { directPeerAccess } from "@/lib/dal/direct-permission";
import {
  createEmptyDirectRoom,
  findDirectRoom,
  initializeDirectMembers,
  requireRequestCapacity,
  renewMessageRequestNotification,
} from "@/lib/dal/direct-requests";
import { withTransaction, type DalDatabase } from "@/lib/dal/database";
import type { RateLimiter } from "@/lib/rate-limit/memory";
import {
  roomChannel,
  spaceChannel,
  userChannel,
} from "@/lib/realtime/channels";
import { getRealtimePublisher } from "@/lib/realtime/server";
import type { RealtimeItem } from "@/lib/realtime/types";
import type { ChatActionDependencies } from "./action-factory";
import { prepareDirectSend } from "./direct-request-flow";
import { excerptOf, extractMentions } from "./message-text";
import { sendMessageSchema } from "./schema";
import { groupDisplayName } from "./group-name";

const requestSchema = sendMessageSchema
  .omit({ roomId: true })
  .extend({ userId: z.uuid().transform((id) => id.toLowerCase()) });
type SendInput = z.infer<typeof sendMessageSchema>;

async function requireWritable(
  userId: string,
  roomId: string,
  now: Date,
  database?: DalDatabase,
) {
  const access = await canWriteRoom(userId, roomId, database, now);
  if (!access.room) throw new ActionError("NOT_FOUND");
  if (!access.canWrite) throw new ActionError("FORBIDDEN");
  return access.room;
}

// 두 진입점은 사용자 → 방 잠금 뒤 같은 중복·요청·메시지 처리를 공유한다.
async function sendLockedMessage(
  input: SendInput,
  session: Session,
  now: Date,
  database: DalDatabase,
  direct?: {
    peerId: string;
    reopenDeclined?: boolean;
    initialEvents?: RealtimeItem[];
  },
) {
  const existing = await writes.findClientMessage(
    input.roomId,
    input.clientId,
    database,
  );
  if (existing) {
    if (existing.authorId !== session.userId)
      throw new ActionError("INVALID_INPUT");
    const readable = await canReadRoom(session.userId, input.roomId, database);
    if (readable)
      await advanceRoomRead(
        {
          roomId: input.roomId,
          userId: session.userId,
          seq: existing.seq,
          now,
        },
        database,
      );
    const message = await getChatMessage(
      existing.id,
      input.roomId,
      session.userId,
      database,
    );
    if (!message) throw new ActionError("INTERNAL");
    return { message, events: [] as RealtimeItem[] };
  }
  const flow = direct
    ? await prepareDirectSend(
        {
          roomId: input.roomId,
          peerId: direct.peerId,
          session,
          now,
          reopenDeclined: direct.reopenDeclined,
        },
        database,
      )
    : { pending: false, events: [] };
  const room = await requireWritable(
    session.userId,
    input.roomId,
    now,
    database,
  );
  if (input.replyToId) {
    const reply = await getChatMessage(
      input.replyToId,
      input.roomId,
      session.userId,
      database,
    );
    if (!reply || reply.kind === "system")
      throw new ActionError("INVALID_INPUT");
  }
  const parsed = extractMentions(input.body);
  const members =
    room.kind === "meeting"
      ? await listMeetingMembers(room.booking!.id, session.userId, database)
      : room.kind === "dm" || room.kind === "group_dm"
        ? await listDirectMembers(room.id, database, session.userId)
        : await listChatMembers(room.teamId!, database, session.userId);
  const names = new Map(members.map((member) => [member.id, member.name]));
  const mentions = parsed.userIds.filter(
    (id) =>
      id !== session.userId &&
      members.some((member) => member.id === id && member.canMention),
  );
  const mentionsEveryone =
    parsed.everyone &&
    !flow.pending &&
    (room.kind === "meeting" ||
      room.kind === "dm" ||
      room.kind === "group_dm" ||
      room.role === "admin");
  const inserted = await writes.insertChatMessage(
    { ...input, mentionsEveryone, authorId: session.userId, now },
    database,
  );
  await writes.insertMessageMentions(inserted.id, mentions, now, database);
  await advanceRoomRead(
    { roomId: input.roomId, userId: session.userId, seq: inserted.seq, now },
    database,
  );
  const message = await getChatMessage(
    inserted.id,
    input.roomId,
    session.userId,
    database,
  );
  if (!message) throw new ActionError("INTERNAL");
  const events: RealtimeItem[] = [
    {
      channel: roomChannel(room.id),
      event: {
        type: "message.created",
        roomId: room.id,
        ...message,
        editedAt: null,
        deletedAt: null,
        reactions: [],
      },
    },
    ...flow.events,
    ...(direct?.initialEvents ?? []),
  ];
  if (!flow.pending) {
    const activityChannels =
      room.kind === "group_dm" || room.kind === "meeting"
        ? members
            .filter((member) => member.id !== session.userId)
            .map((member) => userChannel(member.id))
        : [
            room.kind === "dm"
              ? userChannel(room.peer!.userId)
              : spaceChannel(room.spaceId!),
          ];
    for (const channel of activityChannels)
      events.push({
        channel,
        event: {
          type: "room.activity",
          bookingId: room.booking?.id ?? null,
          spaceId: room.spaceId,
          roomKind: room.kind,
          preview:
            room.kind === "meeting" ||
            room.kind === "dm" ||
            room.kind === "group_dm"
              ? {
                  messageId: message.id,
                  authorName: session.name,
                  excerpt: excerptOf(message.body, names),
                }
              : null,
          roomId: room.id,
          seq: message.seq,
          authorId: message.authorId,
        },
      });
    const recipients = mentionsEveryone
      ? members
          .filter((member) => member.id !== session.userId && member.canMention)
          .map((member) => member.id)
      : mentions;
    for (const recipient of recipients)
      events.push({
        channel: userChannel(recipient),
        event: {
          type: "mention.created",
          bookingId: room.booking?.id ?? null,
          spaceId: room.spaceId,
          roomKind: room.kind,
          roomId: room.id,
          roomName:
            room.kind === "meeting"
              ? (room.booking!.title ?? `${room.booking!.spaceName} 회의`)
              : room.kind === "dm"
                ? session.name
                : room.kind === "group_dm"
                  ? groupDisplayName(
                      room.name,
                      members
                        .filter((member) => member.id !== recipient)
                        .map((member) => member.name),
                    )
                  : (room.name ?? "채널"),
          messageId: message.id,
          seq: message.seq,
          authorName: session.name,
          excerpt: excerptOf(message.body, names),
        },
      });
  }
  // 새 요청의 초기화와 보내기 핵심에서 겹친 재조회 신호는 채널별 한 번이다.
  return {
    message,
    events: events.filter(
      (item, index) =>
        !["friend.changed", "notifications.changed"].includes(
          item.event.type,
        ) ||
        events.findIndex(
          (other) =>
            other.channel === item.channel &&
            other.event.type === item.event.type,
        ) === index,
    ),
  };
}

export function createSendActions(
  dependencies: ChatActionDependencies,
  limiter: RateLimiter,
) {
  const prepare = (userId: string, body: string) => {
    if (!limiter.consume(`chat:send:${userId}`, 10, 10_000).allowed)
      throw new ActionError("LIMIT_EXCEEDED", { message: "send_rate" });
    const parsed = extractMentions(body);
    if (parsed.exceedsLimit) throw new ActionError("INVALID_INPUT");
    return parsed;
  };
  const publish = async (events: RealtimeItem[]) => {
    if (!events.length) return;
    try {
      await (dependencies.publisher ?? getRealtimePublisher()).publishMany(
        events,
      );
    } catch {
      (dependencies.logError ?? console.error)(
        "Chat realtime publication failed.",
      );
    }
  };
  return {
    sendMessage: createAction(
      {
        input: sendMessageSchema,
        authorize: "none",
        async handler({ session, input }) {
          const parsed = prepare(session.userId, input.body);
          const now = dependencies.now?.() ?? new Date();
          const room = await requireWritable(
            session.userId,
            input.roomId,
            now,
            dependencies.database,
          );
          const result = await withTransaction(async (tx) => {
            if (room.kind === "dm")
              await writes.lockMessageUsers(
                session.userId,
                [...parsed.userIds, room.peer!.userId],
                tx,
              );
            else
              await writes.lockUsersForKeyShare(
                [session.userId, ...parsed.userIds],
                tx,
              );
            await writes.lockRoomForMessage(input.roomId, tx);
            await requireWritable(session.userId, input.roomId, now, tx);
            return sendLockedMessage(
              input,
              session,
              now,
              tx,
              room.kind === "dm" ? { peerId: room.peer!.userId } : undefined,
            );
          }, dependencies.database);
          await publish(result.events);
          return result.message;
        },
      },
      dependencies,
    ),
    sendMessageRequest: createAction(
      {
        input: requestSchema,
        authorize: "none",
        async handler({ session, input }) {
          const parsed = prepare(session.userId, input.body);
          if (input.userId === session.userId)
            throw new ActionError("INVALID_INPUT");
          const now = dependencies.now?.() ?? new Date();
          const result = await withTransaction(async (tx) => {
            await writes.lockMessageUsers(
              session.userId,
              [...parsed.userIds, input.userId],
              tx,
            );
            const access = await directPeerAccess(
              session.userId,
              input.userId,
              tx,
            );
            if (!access.existsVerified) throw new ActionError("NOT_FOUND");
            if (access.blocked) throw new ActionError("FORBIDDEN");
            const found = await findDirectRoom(
              session.userId,
              input.userId,
              tx,
            );
            const target = found
              ? { roomId: found.id, created: false }
              : await createEmptyDirectRoom(
                  session.userId,
                  input.userId,
                  now,
                  tx,
                );
            await writes.lockRoomForMessage(target.roomId, tx);
            const initialEvents: RealtimeItem[] = [];
            if (target.created) {
              if (!access.related)
                await requireRequestCapacity(session.userId, now, tx);
              await initializeDirectMembers(
                {
                  roomId: target.roomId,
                  senderId: session.userId,
                  recipientId: input.userId,
                  requested: !access.related,
                  now,
                },
                tx,
              );
              if (!access.related) {
                await renewMessageRequestNotification(
                  {
                    userId: input.userId,
                    actorId: session.userId,
                    actorName: session.name,
                    now,
                  },
                  tx,
                );
                initialEvents.push({
                  channel: userChannel(input.userId),
                  event: { type: "notifications.changed" },
                });
              }
            }
            const sent = await sendLockedMessage(
              { ...input, roomId: target.roomId },
              session,
              now,
              tx,
              { peerId: input.userId, reopenDeclined: true, initialEvents },
            );
            return { ...sent, roomId: target.roomId };
          }, dependencies.database);
          await publish(result.events);
          return { roomId: result.roomId, message: result.message };
        },
      },
      dependencies,
    ),
  };
}
