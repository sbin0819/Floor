import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import {
  canReadRoom,
  canWriteRoom,
  isSpaceAdmin,
  lockMessageSpace,
} from "@/lib/dal/chat-access";
import * as writes from "@/lib/dal/chat-message-write";
import { getChatMessage } from "@/lib/dal/chat-messages";
import {
  deleteMessageAttachments,
  messageHasAttachments,
} from "@/lib/dal/chat-attachments";
import { getFileStorage } from "@/lib/storage";
import { listChannelMembers } from "@/lib/dal/chat-read";
import { listMeetingMembers } from "@/lib/dal/chat-meeting-read";
import { listDirectMembers } from "@/lib/dal/direct";
import {
  insertMessageMentions,
  lockRoomForMessage,
  lockUsersForKeyShare,
} from "@/lib/dal/chat-write";
import { withTransaction } from "@/lib/dal/database";
import type { RateLimiter } from "@/lib/rate-limit/memory";
import { roomChannel, userChannel } from "@/lib/realtime/channels";
import { getRealtimePublisher } from "@/lib/realtime/server";
import type { RealtimeItem } from "@/lib/realtime/types";
import type { ChatActionDependencies } from "./action-factory";
import { excerptOf, extractMentions } from "./message-text";
import { deleteMessageSchema, editMessageSchema } from "./schema";
import { groupDisplayName } from "./group-name";

export function createMessageActions(
  dependencies: ChatActionDependencies,
  limiter: RateLimiter,
) {
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
    editMessage: createAction(
      {
        input: editMessageSchema,
        authorize: "none",
        async handler({ session, input }) {
          if (
            !limiter.consume(`chat:send:${session.userId}`, 10, 10_000).allowed
          )
            throw new ActionError("LIMIT_EXCEEDED", { message: "send_rate" });
          const target = await writes.findMessageTarget(
            input.messageId,
            dependencies.database,
          );
          if (
            !target ||
            target.authorId !== session.userId ||
            target.kind !== "text" ||
            target.deletedAt
          )
            throw new ActionError("NOT_FOUND");
          const now = dependencies.now?.() ?? new Date();
          const access = await canWriteRoom(
            session.userId,
            target.roomId,
            dependencies.database,
            now,
          );
          if (!access.room) throw new ActionError("NOT_FOUND");
          if (!access.canWrite) throw new ActionError("FORBIDDEN");
          const spaceId = access.room.spaceId;
          const parsed = extractMentions(input.body);
          if (parsed.exceedsLimit) throw new ActionError("INVALID_INPUT");
          const result = await withTransaction(async (tx) => {
            await lockUsersForKeyShare(
              [...new Set([session.userId, ...parsed.userIds])].sort(),
              tx,
            );
            await lockMessageSpace(spaceId, tx);
            await lockRoomForMessage(target.roomId, tx);
            const currentAccess = await canWriteRoom(
              session.userId,
              target.roomId,
              tx,
              now,
            );
            if (!currentAccess.room) throw new ActionError("NOT_FOUND");
            if (!currentAccess.canWrite) throw new ActionError("FORBIDDEN");
            const original = await writes.lockChatMessage(input.messageId, tx);
            if (
              !original ||
              original.authorId !== session.userId ||
              original.deletedAt ||
              original.kind !== "text"
            )
              throw new ActionError("NOT_FOUND");
            if (!input.body && !(await messageHasAttachments(original.id, tx)))
              throw new ActionError("INVALID_INPUT");
            const members =
              currentAccess.room.kind === "meeting"
                ? await listMeetingMembers(
                    currentAccess.room.booking!.id,
                    session.userId,
                    tx,
                  )
                : currentAccess.room.kind === "dm" ||
                    currentAccess.room.kind === "group_dm"
                  ? await listDirectMembers(target.roomId, tx, session.userId)
                  : await listChannelMembers(
                      currentAccess.room,
                      session.userId,
                      tx,
                      { mentionAuthorId: session.userId },
                    );
            const names = new Map(
              members.map((member) => [member.id, member.name]),
            );
            const mentions = parsed.userIds.filter(
              (id) =>
                id !== session.userId &&
                members.some((member) => member.id === id && member.canMention),
            );
            const everyone =
              parsed.everyone &&
              (currentAccess.room.kind !== "dm" ||
                (currentAccess.room.directMembership?.mine === "active" &&
                  currentAccess.room.directMembership.peer === "active")) &&
              (currentAccess.room.kind === "dm" ||
                currentAccess.room.kind === "meeting" ||
                currentAccess.room.kind === "group_dm" ||
                isSpaceAdmin(currentAccess.room.role));
            const oldMentions = new Set(
              (await writes.listStoredMentions(original.id, tx)).map(
                (row) => row.userId,
              ),
            );
            if (
              !(await writes.editChatMessage(
                {
                  id: original.id,
                  userId: session.userId,
                  body: input.body,
                  mentionsEveryone: everyone,
                  now,
                },
                tx,
              ))
            )
              throw new ActionError("NOT_FOUND");
            await writes.removeMessageMentions(original.id, tx);
            await insertMessageMentions(original.id, mentions, now, tx);
            const candidates = (
              everyone
                ? members
                    .filter((member) => member.canMention)
                    .map((member) => member.id)
                : mentions
            ).filter(
              (id) =>
                id !== session.userId &&
                !original.mentionsEveryone &&
                !oldMentions.has(id),
            );
            const recipients = await writes.unreadMentionRecipients(
              {
                roomId: target.roomId,
                userIds: candidates,
                seq: original.seq,
                createdAt: original.createdAt,
              },
              tx,
            );
            const message = await getChatMessage(
              original.id,
              target.roomId,
              session.userId,
              tx,
            );
            if (!message) throw new ActionError("INTERNAL");
            return { message, recipients, names, room: currentAccess.room };
          }, dependencies.database);
          const { message } = result;
          const events: RealtimeItem[] = [
            {
              channel: roomChannel(target.roomId),
              event: {
                type: "message.updated",
                roomId: target.roomId,
                id: message.id,
                seq: message.seq,
                body: message.body,
                mentions: message.mentions,
                mentionsEveryone: message.mentionsEveryone,
                editedAt: message.editedAt!,
              },
            },
          ];
          for (const recipient of result.recipients)
            events.push({
              channel: userChannel(recipient.userId),
              event: {
                type: "mention.created",
                bookingId: result.room.booking?.id ?? null,
                spaceId: result.room.spaceId,
                roomKind: result.room.kind,
                roomId: target.roomId,
                roomName:
                  result.room.kind === "meeting"
                    ? (result.room.booking!.title ??
                      `${result.room.booking!.spaceName} 회의`)
                    : result.room.kind === "dm"
                      ? session.name
                      : result.room.kind === "group_dm"
                        ? groupDisplayName(
                            result.room.name,
                            [...result.names]
                              .filter(([id]) => id !== recipient.userId)
                              .map(([, name]) => name),
                          )
                        : (result.room.name ?? "채널"),
                messageId: message.id,
                seq: message.seq,
                authorName: session.name ?? "알 수 없는 사용자",
                excerpt: excerptOf(
                  message.body,
                  result.names,
                  message.attachments,
                ),
              },
            });
          await publish(events);
          return message;
        },
      },
      dependencies,
    ),
    deleteMessage: createAction(
      {
        input: deleteMessageSchema,
        authorize: "none",
        async handler({ session, input }) {
          const target = await writes.findMessageTarget(
            input.messageId,
            dependencies.database,
          );
          if (!target) throw new ActionError("NOT_FOUND");
          const access = await canReadRoom(
            session.userId,
            target.roomId,
            dependencies.database,
          );
          if (!access) throw new ActionError("NOT_FOUND");
          const now = dependencies.now?.() ?? new Date();
          const result = await withTransaction(async (tx) => {
            await lockUsersForKeyShare([session.userId], tx);
            await lockMessageSpace(access.spaceId, tx);
            await lockRoomForMessage(target.roomId, tx);
            const room = await canReadRoom(session.userId, target.roomId, tx);
            if (!room) throw new ActionError("NOT_FOUND");
            const original = await writes.lockChatMessage(input.messageId, tx);
            if (
              !original ||
              original.kind !== "text" ||
              (original.authorId !== session.userId && !isSpaceAdmin(room.role))
            )
              throw new ActionError("NOT_FOUND");
            const changed = await writes.deleteChatMessage(
              {
                id: original.id,
                userId: session.userId,
                admin: isSpaceAdmin(room.role),
                now,
              },
              tx,
            );
            const attachments = changed
              ? await deleteMessageAttachments(original.id, target.roomId, tx)
              : [];
            return { id: original.id, seq: original.seq, changed, attachments };
          }, dependencies.database);
          for (const attachment of result.attachments) {
            try {
              await (dependencies.storage ?? getFileStorage()).remove(
                attachment.storageKey,
              );
            } catch {
              (dependencies.logError ?? console.error)(
                "Chat attachment cleanup failed.",
              );
            }
          }
          if (result.changed)
            await publish([
              {
                channel: roomChannel(target.roomId),
                event: {
                  type: "message.deleted",
                  roomId: target.roomId,
                  id: result.id,
                  seq: result.seq,
                },
              },
            ]);
          return { id: result.id };
        },
      },
      dependencies,
    ),
  };
}
