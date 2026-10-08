"use client";

import { useCallback, useEffect } from "react";
import {
  skipToken,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRealtimeChannel } from "@/components/realtime-provider";
import type { ActionResult } from "@/lib/actions/result";
import { roomChannel } from "@/lib/realtime/channels";
import { sendMessage } from "@/features/chat/actions";
import type { ChannelView, ChatMessage } from "../types";
import {
  mergeChatMessages,
  roomMessagesKey,
  type DisplayMessage,
} from "./message-state";

export type SendChatMessage = (input: {
  roomId: string;
  clientId: string;
  body: string;
}) => Promise<ActionResult<ChatMessage>>;

export function useChannelMessages(
  data: ChannelView,
  send: SendChatMessage = sendMessage,
) {
  const client = useQueryClient();
  const router = useRouter();
  const roomId = data.room.id;
  const userId = data.user.id;
  const query = useQuery<DisplayMessage[]>({
    queryKey: roomMessagesKey(roomId),
    queryFn: skipToken,
    initialData: data.messages,
    staleTime: Infinity,
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
    const lastSeq = current.reduce(
      (last, row) => Math.max(last, row.delivery ? 0 : row.seq),
      0,
    );
    // 다른 사람의 전송 ID는 내 임시 메시지와 합치는 데 사용하지 않는다.
    merge([
      {
        id: event.id,
        seq: event.seq,
        authorId: event.authorId,
        authorName: event.authorName,
        kind: event.kind,
        body: event.body,
        createdAt: event.createdAt,
        clientId: event.authorId === userId ? event.clientId : null,
      },
    ]);
    if (event.seq > Math.max(lastSeq, data.room.lastSeq) + 1) router.refresh();
  });
  const fail = (
    targetRoomId: string,
    clientId: string,
    result?: Extract<ActionResult<ChatMessage>, { ok: false }>,
  ) => {
    client.setQueryData<DisplayMessage[]>(
      roomMessagesKey(targetRoomId),
      (current = []) =>
        current.map((row) =>
          row.clientId === clientId && row.authorId === userId && row.delivery
            ? {
                ...row,
                delivery: "failed",
                errorCode: result?.code ?? "INTERNAL",
                errorMessage: result?.message,
              }
            : row,
        ),
    );
  };
  const mutation = useMutation({
    mutationKey: ["chat", "send", roomId],
    scope: { id: `chat-send:${roomId}` },
    networkMode: "always",
    retry: false,
    mutationFn: send,
    onSuccess(result, input) {
      // 방 이동 뒤 도착한 응답도 제출 당시 방에만 반영한다.
      if (result.ok)
        client.setQueryData<DisplayMessage[]>(
          roomMessagesKey(input.roomId),
          (current = []) => mergeChatMessages(current, [result.data], userId),
        );
      else fail(input.roomId, input.clientId, result);
    },
    onError(_error, input) {
      fail(input.roomId, input.clientId);
    },
  });
  const submit = (body: string) => {
    const clientId = crypto.randomUUID();
    const pending: DisplayMessage = {
      id: clientId,
      clientId,
      seq: 0,
      authorId: userId,
      authorName: data.user.name,
      kind: "text",
      body,
      createdAt: new Date().toISOString(),
      delivery: "pending",
    };
    client.setQueryData<DisplayMessage[]>(
      roomMessagesKey(roomId),
      (current = []) => [...current, pending],
    );
    mutation.mutate({ roomId, clientId, body });
  };
  const retry = (message: DisplayMessage) => {
    if (
      !message.clientId ||
      message.authorId !== userId ||
      message.delivery !== "failed"
    )
      return;
    client.setQueryData<DisplayMessage[]>(
      roomMessagesKey(roomId),
      (current = []) =>
        current.map((row) =>
          row.id === message.id
            ? {
                ...row,
                delivery: "pending",
                errorCode: undefined,
                errorMessage: undefined,
              }
            : row,
        ),
    );
    mutation.mutate({ roomId, clientId: message.clientId, body: message.body });
  };
  const remove = (message: DisplayMessage) => {
    client.setQueryData<DisplayMessage[]>(
      roomMessagesKey(roomId),
      (current = []) =>
        current.filter(
          (row) =>
            !(
              row.id === message.id &&
              row.delivery === "failed" &&
              row.authorId === userId
            ),
        ),
    );
  };
  return { messages: query.data ?? data.messages, submit, retry, remove };
}
