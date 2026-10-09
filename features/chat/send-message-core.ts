import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import { canReadRoom, canWriteRoom, isSpaceAdmin } from "@/lib/dal/chat-access";
import { advanceRoomRead } from "@/lib/dal/chat-reads";
import { listChannelMembers } from "@/lib/dal/chat-read";
import { listMeetingMembers } from "@/lib/dal/chat-meeting-read";
import { getChatMessage } from "@/lib/dal/chat-messages";
import {
  attachMessageFiles,
  lockMessageAttachments,
} from "@/lib/dal/chat-attachments";
import { totalUploadBytes } from "@/lib/dal/chat-uploads";
import * as writes from "@/lib/dal/chat-write";
import { listDirectMembers } from "@/lib/dal/direct";
import type { DalDatabase } from "@/lib/dal/database";
import {
  roomChannel,
  spaceChannel,
  userChannel,
} from "@/lib/realtime/channels";
import type { RealtimeItem } from "@/lib/realtime/types";
import { prepareDirectSend } from "./direct-request-flow";
import { excerptOf, extractMentions } from "./message-text";
import { sendMessageSchema } from "./schema";
import { groupDisplayName } from "./group-name";
import { MAX_STORAGE_BYTES, UPLOAD_LIFETIME_MS } from "./upload-types";

type SendInput = z.infer<typeof sendMessageSchema>;

export async function requireWritable(
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

// 호출자가 사용자 → 스페이스 → 방을 잠근 트랜잭션에서만 호출한다.
export async function sendLockedMessage(
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
  if (direct && input.attachmentIds.length) {
    const access = await requireWritable(
      session.userId,
      input.roomId,
      now,
      database,
    );
    if (
      access.directMembership?.mine !== "active" ||
      access.directMembership.peer !== "active"
    )
      throw new ActionError("FORBIDDEN");
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
  const files = await lockMessageAttachments(input.attachmentIds, database);
  if (
    files.length !== input.attachmentIds.length ||
    files.some(
      (file) =>
        file.uploaderId !== session.userId ||
        file.roomId !== input.roomId ||
        !file.uploadedAt ||
        file.messageId !== null ||
        file.createdAt.getTime() <= now.getTime() - 24 * 60 * 60 * 1000,
    )
  )
    throw new ActionError("INVALID_INPUT", {
      fieldErrors: { attachmentIds: ["unavailable"] },
    });
  // 먼저 시작한 전송이 만료 경계 뒤의 새 할당보다 늦게 잠길 수 있다.
  // 할당과 같은 사용자 잠금 아래 다시 세어, 이미 제외된 예약 용량이 되살아나지 않게 한다.
  if (
    files.length &&
    (await totalUploadBytes(
      session.userId,
      new Date(now.getTime() - UPLOAD_LIFETIME_MS),
      database,
    )) > MAX_STORAGE_BYTES
  )
    throw new ActionError("LIMIT_EXCEEDED", { message: "storage_quota" });
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
        : await listChannelMembers(room, session.userId, database, {
            mentionAuthorId: session.userId,
          });
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
      isSpaceAdmin(room.role));
  const inserted = await writes.insertChatMessage(
    { ...input, mentionsEveryone, authorId: session.userId, now },
    database,
  );
  await attachMessageFiles(input.attachmentIds, inserted.id, database);
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
                  excerpt: excerptOf(message.body, names, message.attachments),
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
          excerpt: excerptOf(message.body, names, message.attachments),
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
