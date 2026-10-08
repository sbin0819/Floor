"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import {
  useRealtimeConnectionState,
  useRealtimeLifecycle,
} from "@/components/realtime-provider";
import {
  createChatSendQueue,
  type SendChatMessage,
  type QueuedMessage,
} from "../send-queue";
import {
  CHAT_NAV_KEY,
  applyDirectActivity,
  chatNavRevision,
  clearRoomUnread,
} from "../nav-state";
import type { ChatReply } from "../types";
import type { RoomMessageSource } from "../room-message-source";
import { emptyMessageDetails } from "../types";
import {
  mergeChatMessages,
  roomMessagesKey,
  type DisplayMessage,
} from "./message-state";

const queues = new WeakMap<QueryClient, ReturnType<typeof makeQueue>>();
function makeQueue(client: QueryClient) {
  let users = 0;
  let listening = false;
  const queue = createChatSendQueue({
    online: () => navigator.onLine !== false,
    confirmed(entry, message) {
      client.setQueryData<DisplayMessage[]>(
        roomMessagesKey(entry.roomId),
        (current = []) =>
          mergeChatMessages(current, [message], entry.message.authorId!),
      );
      if (entry.roomKind === "dm" || entry.roomKind === "group_dm") {
        const changed = applyDirectActivity(
          client,
          {
            roomId: entry.roomId,
            seq: message.seq,
            authorId: message.authorId,
          },
          entry.message.authorId!,
          message.createdAt,
        );
        if (changed === "missing")
          void client.invalidateQueries({ queryKey: CHAT_NAV_KEY });
      }
      clearRoomUnread(
        client,
        entry.roomId,
        message.seq,
        entry.navigationRevision,
      );
    },
    failed(entry, result) {
      client.setQueryData<DisplayMessage[]>(
        roomMessagesKey(entry.roomId),
        (current = []) =>
          current.map((row) =>
            row.clientId === entry.message.clientId &&
            row.authorId === entry.message.authorId &&
            row.delivery
              ? {
                  ...row,
                  delivery: "failed",
                  errorCode: result.code,
                  errorMessage: result.message,
                }
              : row,
          ),
      );
    },
  });
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (!queue.pending()) return;
    event.preventDefault();
    event.returnValue = "";
  };
  const syncListeners = () => {
    const needed = users > 0 || queue.pending() > 0;
    if (needed === listening) return;
    listening = needed;
    if (needed) {
      window.addEventListener("online", queue.resume);
      window.addEventListener("beforeunload", beforeUnload);
    } else {
      window.removeEventListener("online", queue.resume);
      window.removeEventListener("beforeunload", beforeUnload);
    }
  };
  queue.subscribe(syncListeners);
  return {
    ...queue,
    mount() {
      users += 1;
      syncListeners();
      return () => {
        users -= 1;
        syncListeners();
      };
    },
  };
}
function getQueue(client: QueryClient) {
  let queue = queues.get(client);
  if (!queue) {
    queue = makeQueue(client);
    queues.set(client, queue);
  }
  return queue;
}
const noPending = () => 0;

// 채널을 떠난 동안에도 연결 복구가 이미 만든 대기열을 이어 보낸다.
export function ChatQueueConnection() {
  const client = useQueryClient();
  useRealtimeLifecycle((event) => {
    if (event.type === "connection" && event.current === "connected")
      queues.get(client)?.resume();
  });
  return null;
}

export function useChatSendQueue(
  data: RoomMessageSource,
  send: SendChatMessage,
  directKind: false | "dm" | "group_dm" = false,
) {
  const client = useQueryClient();
  const queue = getQueue(client);
  const roomId = data.room.id;
  const userId = data.user.id;
  const mutation = useMutation({
    mutationKey: ["chat", "send", roomId],
    scope: { id: `chat-send:${roomId}` },
    mutationFn: (input: Parameters<SendChatMessage>[0]) => send(input),
    networkMode: "always",
    retry: false,
  });
  const connection = useRealtimeConnectionState();
  useEffect(() => queue.mount(), [queue]);
  useEffect(() => {
    if (connection === "connected") queue.resume();
  }, [connection, queue]);
  const snapshot = useCallback(() => queue.pending(), [queue]);
  const pending =
    useSyncExternalStore(queue.subscribe, snapshot, noPending) > 0;
  const enqueue = (message: DisplayMessage & { clientId: string }) => {
    // 오래 다른 화면을 보더라도 아직 보내지 못한 메시지는 캐시에서 지워지지 않는다.
    client.setQueryDefaults(roomMessagesKey(roomId), { gcTime: Infinity });
    const entry: QueuedMessage = {
      roomId,
      ...(directKind ? { roomKind: directKind } : {}),
      message,
      send(input) {
        entry.navigationRevision = chatNavRevision(client);
        return mutation.mutateAsync(input);
      },
    };
    queue.enqueue(entry);
  };
  const submit = (body: string, reply?: ChatReply) => {
    const clientId = crypto.randomUUID();
    const message: DisplayMessage & { clientId: string } = {
      ...emptyMessageDetails(),
      replyTo: reply ?? null,
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
      (current = []) => [...current, message],
    );
    enqueue(message);
  };
  const retry = (message: DisplayMessage) => {
    if (
      !message.clientId ||
      message.authorId !== userId ||
      message.delivery !== "failed"
    )
      return;
    const next = {
      ...message,
      clientId: message.clientId,
      delivery: "pending" as const,
      errorCode: undefined,
      errorMessage: undefined,
    };
    client.setQueryData<DisplayMessage[]>(
      roomMessagesKey(roomId),
      (current = []) =>
        current.map((row) => (row.id === message.id ? next : row)),
    );
    enqueue(next);
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
  return { submit, retry, remove, pending };
}
