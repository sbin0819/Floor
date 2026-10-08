"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  useRealtimeChannel,
  useRealtimeLifecycle,
} from "@/components/realtime-provider";
import { roomChannel } from "@/lib/realtime/channels";
import { sendMessage } from "@/features/chat/actions";
import type { ChatMessage } from "../types";
import type { RoomMessageSource } from "../room-message-source";
import { useChannelCatchUp } from "./use-channel-catch-up";
import { useChatSendQueue } from "./use-chat-send-queue";
import type { SendChatMessage } from "../send-queue";
import { createMessageSync } from "../message-sync";
import { withReactionIntents } from "./use-message-mutations";
import {
  mergeChatMessages,
  roomMessagesKey,
  type DisplayMessage,
} from "./message-state";

export type { SendChatMessage } from "../send-queue";

const noLiveMessages: ChatMessage[] = [];

export function useChannelMessages(
  data: RoomMessageSource,
  send: SendChatMessage = sendMessage,
  onPageRead?: (roomId: string, seq: number) => void,
  directKind: false | "dm" | "group_dm" = false,
) {
  const client = useQueryClient();
  const roomId = data.room.id;
  const userId = data.user.id;
  const sync = useMemo(
    () => createMessageSync(client, roomId, userId),
    [client, roomId, userId],
  );
  useEffect(() => {
    sync.start();
    return () => sync.stop();
  }, [sync]);
  const wasDisconnected = useRef(false);
  useRealtimeLifecycle((event) => {
    if (event.type === "connection") {
      if (["disconnected", "suspended", "failed"].includes(event.current))
        wasDisconnected.current = true;
      else if (event.current === "connected" && wasDisconnected.current) {
        wasDisconnected.current = false;
        sync.revalidate();
        void client.invalidateQueries({
          queryKey: ["chat", "room", roomId, "files"],
        });
      }
    } else if (event.channel === roomChannel(roomId) && !event.resumed) {
      sync.revalidate();
      void client.invalidateQueries({
        queryKey: ["chat", "room", roomId, "files"],
      });
    }
  });
  const catchUp = useChannelCatchUp(data, onPageRead);
  const sending = useChatSendQueue(data, send, directKind);
  const liveBuffer = useRef<{
    roomId: string;
    messages: ChatMessage[];
    active: boolean;
  } | null>(null);
  const [liveBatch, setLiveBatch] = useState<{
    roomId: string;
    messages: ChatMessage[];
  }>({ roomId, messages: noLiveMessages });
  useEffect(() => {
    const buffer = { roomId, messages: [] as ChatMessage[], active: true };
    liveBuffer.current = buffer;
    return () => {
      buffer.active = false;
      buffer.messages = [];
    };
  }, [roomId]);
  const query = useQuery<DisplayMessage[]>({
    queryKey: roomMessagesKey(roomId),
    queryFn: skipToken,
    initialData: data.messages,
    staleTime: Infinity,
    gcTime: Infinity,
    enabled: false,
    refetchOnMount: false,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });
  const merge = useCallback(
    (incoming: ChatMessage[]) => {
      client.setQueryData<DisplayMessage[]>(
        roomMessagesKey(roomId),
        (current = []) =>
          sync.project(mergeChatMessages(current, incoming, userId)),
      );
    },
    [client, roomId, userId, sync],
  );
  const announce = useCallback(
    (incoming: ChatMessage[]) => {
      const buffer = liveBuffer.current;
      if (
        !buffer ||
        buffer.roomId !== roomId ||
        !buffer.active ||
        !incoming.length
      )
        return;
      const empty = buffer.messages.length === 0;
      buffer.messages.push(...incoming);
      if (empty)
        queueMicrotask(() => {
          if (!buffer.active) return;
          const confirmed =
            client.getQueryData<DisplayMessage[]>(roomMessagesKey(roomId)) ??
            [];
          setLiveBatch({
            roomId,
            messages: buffer.messages.flatMap((received) => {
              const saved = confirmed.find((row) => row.id === received.id);
              return saved && !saved.deletedAt ? [saved] : [];
            }),
          });
          buffer.messages = [];
        });
    },
    [client, roomId],
  );
  const serverCursor = useRef({ roomId, seq: data.room.lastSeq });
  useEffect(() => {
    const previous = serverCursor.current;
    const current =
      client.getQueryData<DisplayMessage[]>(roomMessagesKey(roomId)) ?? [];
    merge(data.messages);
    // 그룹 변경은 room.changed 뒤의 서버 갱신으로 오므로 새 시스템 행만 알린다.
    if (previous.roomId === roomId)
      announce(
        data.messages.filter(
          (message) =>
            message.kind === "system" &&
            message.seq > previous.seq &&
            !current.some((row) => row.id === message.id),
        ),
      );
    serverCursor.current = {
      roomId,
      seq: Math.max(
        previous.roomId === roomId ? previous.seq : 0,
        data.room.lastSeq,
      ),
    };
  }, [data.messages, data.room.lastSeq, merge, announce, client, roomId]);
  useRealtimeChannel(roomChannel(roomId), (event) => {
    if (event.type === "message.updated" || event.type === "message.deleted") {
      if (event.roomId !== roomId) return;
      if (event.type === "message.deleted")
        void client.invalidateQueries({
          queryKey: ["chat", "room", roomId, "files"],
        });
      sync.receiveChange(
        event,
        new Map(data.members.map((member) => [member.id, member.name])),
      );
      return;
    }
    if (event.type === "reaction.changed") {
      if (event.roomId !== roomId) return;
      const message = client
        .getQueryData<DisplayMessage[]>(roomMessagesKey(roomId))
        ?.find((row) => row.id === event.messageId);
      if (message) sync.changed(message.seq);
      return;
    }
    if (event.type !== "message.created" || event.roomId !== roomId) return;
    if (event.attachments.length)
      void client.invalidateQueries({
        queryKey: ["chat", "room", roomId, "files"],
      });
    const current =
      client.getQueryData<DisplayMessage[]>(roomMessagesKey(roomId)) ?? [];
    // 다른 사람의 전송 ID는 내 임시 메시지와 합치는 데 사용하지 않는다.
    const message: ChatMessage = {
      id: event.id,
      seq: event.seq,
      authorId: event.authorId,
      authorName: event.authorName,
      kind: event.kind,
      systemData: event.systemData,
      body: event.body,
      attachments: event.attachments,
      createdAt: event.createdAt,
      clientId: event.authorId === userId ? event.clientId : null,
      replyTo: event.replyTo,
      mentions: event.mentions,
      mentionsEveryone: event.mentionsEveryone,
      editedAt: event.editedAt,
      deletedAt: event.deletedAt,
      reactions: event.reactions,
    };
    // created 재전송은 이미 고치거나 지운 서버 행을 되살리지 않는다.
    if (!current.some((row) => row.id === event.id && !row.delivery))
      merge([message]);
    catchUp.receive(event.seq);
    if (
      event.authorId !== userId &&
      !current.some((row) => row.id === event.id)
    )
      announce([message]);
  });
  const rows: DisplayMessage[] = query.data ?? data.messages;
  const messages = useMemo(
    () => sync.project(rows).map(withReactionIntents),
    [rows, sync],
  );
  return {
    messages,
    reportVisible: sync.visible,
    submit: sending.submit,
    retry: sending.retry,
    remove: sending.remove,
    reconnecting: catchUp.reconnecting,
    historyReset: catchUp.historyReset,
    liveMessages:
      liveBatch.roomId === roomId ? liveBatch.messages : noLiveMessages,
    sending: sending.pending,
  };
}
