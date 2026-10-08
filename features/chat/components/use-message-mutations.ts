"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { deleteMessage, editMessage, setReaction } from "../actions";
import type { ChatMessage, ReactionEmoji } from "../types";
import { applyMessageEvent, invalidateMessage } from "../message-sync";
import { roomMessagesKey, type DisplayMessage } from "./message-state";

export function withReactionIntents(message: DisplayMessage): DisplayMessage {
  if (!message.reactionIntents || message.deletedAt) return message;
  const reactions = message.reactions.map((reaction) => ({ ...reaction }));
  for (const [emoji, intent] of Object.entries(message.reactionIntents)) {
    if (!intent) continue;
    const reaction = reactions.find((reaction) => reaction.emoji === emoji);
    if (reaction) {
      if (reaction.mine !== intent.on)
        reaction.count = Math.max(0, reaction.count + (intent.on ? 1 : -1));
      reaction.mine = intent.on;
    } else if (intent.on)
      reactions.push({
        emoji: emoji as ReactionEmoji,
        mine: true,
        count: 1,
        names: [],
      });
  }
  return {
    ...message,
    reactions: reactions.filter((reaction) => reaction.count > 0),
  };
}

export function useMessageMutations({
  roomId,
  members,
}: {
  roomId: string;
  userId: string;
  members: readonly { id: string; name: string }[];
}) {
  const client = useQueryClient();
  const reactions = useMutation({
    mutationFn: setReaction,
    retry: false,
    scope: { id: `chat-reactions:${roomId}` },
  });
  const edits = useMutation({
    mutationFn: editMessage,
    retry: false,
    scope: { id: `chat-edits:${roomId}` },
  });
  const deletions = useMutation({
    mutationFn: deleteMessage,
    retry: false,
    scope: { id: `chat-edits:${roomId}` },
  });
  const names = new Map(members.map((member) => [member.id, member.name]));
  const update = (transform: (rows: DisplayMessage[]) => DisplayMessage[]) =>
    client.setQueryData<DisplayMessage[]>(
      roomMessagesKey(roomId),
      (rows = []) => transform(rows),
    );
  return {
    async react(message: ChatMessage, emoji: ReactionEmoji, on: boolean) {
      const token = crypto.randomUUID();
      invalidateMessage(client, roomId, message.seq);
      update((rows) =>
        rows.map((row) =>
          row.id === message.id && !row.deletedAt
            ? {
                ...row,
                reactionIntents: {
                  ...row.reactionIntents,
                  [emoji]: { token, on },
                },
              }
            : row,
        ),
      );
      let success = false;
      try {
        const result = await reactions.mutateAsync({
          messageId: message.id,
          emoji,
          on,
        });
        success = result.ok;
        if (result.ok)
          update((rows) =>
            rows.map((row) => {
              if (
                row.id !== message.id ||
                row.deletedAt ||
                row.reactionIntents?.[emoji]?.token !== token
              )
                return row;
              // 액션의 count는 참고 값이다. 그동안 들어온 다른 사람의 반응을 과거 수로 덮지 않는다.
              return { ...row, reactions: withReactionIntents(row).reactions };
            }),
          );
      } catch {
        success = false;
      } finally {
        invalidateMessage(client, roomId, message.seq);
        update((rows) =>
          rows.map((row) => {
            if (
              row.id !== message.id ||
              row.reactionIntents?.[emoji]?.token !== token
            )
              return row;
            const intents = { ...row.reactionIntents };
            delete intents[emoji];
            return { ...row, reactionIntents: intents };
          }),
        );
      }
      if (!success)
        toast.error("리액션을 바꾸지 못했어요. 다시 시도해 주세요.");
      return success;
    },
    async edit(messageId: string, body: string) {
      try {
        const result = await edits.mutateAsync({ messageId, body });
        if (result.ok) {
          const row = result.data;
          invalidateMessage(client, roomId, row.seq);
          update((rows) =>
            applyMessageEvent(
              rows,
              {
                type: "message.updated",
                roomId,
                id: row.id,
                seq: row.seq,
                body: row.body,
                mentions: row.mentions,
                mentionsEveryone: row.mentionsEveryone,
                editedAt: row.editedAt!,
              },
              names,
            ),
          );
          return true;
        }
      } catch {
        /* 입력은 그대로 남겨 다시 시도할 수 있게 한다. */
      }
      toast.error("메시지를 고치지 못했어요. 다시 시도해 주세요.");
      return false;
    },
    async remove(messageId: string) {
      try {
        const result = await deletions.mutateAsync({ messageId });
        if (result.ok) {
          update((rows) =>
            applyMessageEvent(
              rows,
              {
                type: "message.deleted",
                roomId,
                id: messageId,
                seq: rows.find((row) => row.id === messageId)?.seq ?? 0,
              },
              names,
            ),
          );
          return true;
        }
      } catch {
        /* 확인 창에서 다시 시도할 수 있게 한다. */
      }
      toast.error("메시지를 지우지 못했어요. 다시 시도해 주세요.");
      return false;
    },
  };
}
