"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRealtimeChannel } from "@/components/realtime-provider";
import { roomChannel } from "@/lib/realtime/channels";
import { sendMessage } from "@/features/chat/actions";
import type { ChannelView, ChatMessage } from "../types";
import { useChannelCatchUp } from "./use-channel-catch-up";
import { useChatSendQueue } from "./use-chat-send-queue";
import type { SendChatMessage } from "../send-queue";
import {
  mergeChatMessages,
  roomMessagesKey,
  type DisplayMessage,
} from "./message-state";

export type { SendChatMessage } from "../send-queue";

const noLiveMessages: ChatMessage[] = [];

export function useChannelMessages(
  data: ChannelView,
  send: SendChatMessage = sendMessage,
) {
  const client = useQueryClient();
  const roomId = data.room.id;
  const userId = data.user.id;
  const catchUp = useChannelCatchUp(data);
  const sending = useChatSendQueue(data, send);
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
        (current = []) => mergeChatMessages(current, incoming, userId),
      );
    },
    [client, roomId, userId],
  );
  useEffect(() => {
    merge(data.messages);
  }, [data.messages, merge]);
  useRealtimeChannel(roomChannel(roomId), (event) => {
    if (event.type !== "message.created" || event.roomId !== roomId) return;
    const current =
      client.getQueryData<DisplayMessage[]>(roomMessagesKey(roomId)) ?? [];
    // 다른 사람의 전송 ID는 내 임시 메시지와 합치는 데 사용하지 않는다.
    const message: ChatMessage = {
      id: event.id,
      seq: event.seq,
      authorId: event.authorId,
      authorName: event.authorName,
      kind: event.kind,
      body: event.body,
      createdAt: event.createdAt,
      clientId: event.authorId === userId ? event.clientId : null,
    };
    merge([message]);
    catchUp.receive(event.seq);
    if (
      event.authorId !== userId &&
      !current.some((row) => row.id === event.id)
    ) {
      const buffer = liveBuffer.current;
      if (!buffer || buffer.roomId !== roomId || !buffer.active) return;
      buffer.messages.push(message);
      if (buffer.messages.length === 1)
        queueMicrotask(() => {
          if (!buffer.active) return;
          setLiveBatch({ roomId, messages: buffer.messages });
          buffer.messages = [];
        });
    }
  });
  const messages: DisplayMessage[] = query.data ?? data.messages;
  return {
    messages,
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
