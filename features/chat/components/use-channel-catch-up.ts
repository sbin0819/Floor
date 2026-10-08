"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useRealtimeConnectionState,
  useRealtimeLifecycle,
} from "@/components/realtime-provider";
import { roomChannel } from "@/lib/realtime/channels";
import { createRoomCatchUp } from "../catch-up";
import type { ChannelView } from "../types";
import {
  mergeChatMessages,
  roomMessagesKey,
  type DisplayMessage,
} from "./message-state";

export function useChannelCatchUp(data: ChannelView) {
  const client = useQueryClient();
  const roomId = data.room.id;
  const userId = data.user.id;
  const connection = useRealtimeConnectionState();
  const catchUp = useMemo(
    () =>
      createRoomCatchUp({
        roomId,
        merge(messages) {
          client.setQueryData<DisplayMessage[]>(
            roomMessagesKey(roomId),
            (current = []) => mergeChatMessages(current, messages, userId),
          );
        },
        replace(messages) {
          client.setQueryData<DisplayMessage[]>(
            roomMessagesKey(roomId),
            (current = []) =>
              mergeChatMessages(
                current.filter((message) => Boolean(message.delivery)),
                messages,
                userId,
              ),
          );
        },
      }),
    [client, roomId, userId],
  );
  const start = useEffectEvent(() => {
    catchUp.start(
      Math.max(
        data.room.lastSeq,
        0,
        ...data.messages.map((message) => message.seq),
      ),
    );
  });
  useEffect(() => {
    // 다른 방으로 전환하면 그 방의 서버 스냅샷에서 다시 시작한다.
    start();
    return () => catchUp.stop();
  }, [catchUp]);
  const attached = useRef<{ roomId: string; seen: boolean }>({
    roomId,
    seen: false,
  });
  useEffect(() => {
    attached.current = { roomId, seen: false };
  }, [roomId]);
  useEffect(() => {
    if (
      connection === "disconnected" ||
      connection === "suspended" ||
      connection === "failed"
    )
      catchUp.disconnected();
    else if (connection === "connected") catchUp.connected();
  }, [catchUp, connection]);
  useRealtimeLifecycle((event) => {
    if (event.type === "connection") {
      if (
        event.current === "disconnected" ||
        event.current === "suspended" ||
        event.current === "failed"
      )
        catchUp.disconnected();
      else if (event.current === "connected") catchUp.connected();
      return;
    }
    if (event.channel !== roomChannel(roomId)) return;
    if (!attached.current.seen || !event.resumed) void catchUp.sync();
    attached.current = { roomId, seen: true };
  });
  const receive = useCallback((seq: number) => catchUp.receive(seq), [catchUp]);
  const snapshot = useSyncExternalStore(
    catchUp.subscribe,
    catchUp.getSnapshot,
    catchUp.getSnapshot,
  );
  return { ...snapshot, receive };
}
