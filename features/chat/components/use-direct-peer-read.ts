"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRealtimeChannel } from "@/components/realtime-provider";
import { roomChannel } from "@/lib/realtime/channels";

export function useDirectPeerRead(
  roomId: string,
  peerId: string | null,
  initialSeq: number,
) {
  const [cursor, setCursor] = useState({ roomId, seq: initialSeq });
  const active = useRef<{ roomId: string; peerId: string | null } | null>(null);
  useEffect(() => {
    active.current = { roomId, peerId };
    return () => {
      active.current = null;
    };
  }, [roomId, peerId]);
  const receivePage = useCallback(
    (room: string, seq: number) => {
      if (
        !peerId ||
        room !== roomId ||
        active.current?.roomId !== roomId ||
        active.current.peerId !== peerId
      )
        return;
      setCursor((previous) => ({
        roomId,
        seq: Math.max(
          initialSeq,
          previous.roomId === roomId ? previous.seq : 0,
          seq,
        ),
      }));
    },
    [roomId, peerId, initialSeq],
  );
  useRealtimeChannel(peerId ? roomChannel(roomId) : null, (event) => {
    if (
      event.type === "room.read" &&
      event.roomId === roomId &&
      event.userId === peerId
    )
      receivePage(roomId, event.seq);
    if (
      event.type === "message.created" &&
      event.roomId === roomId &&
      event.authorId === peerId
    )
      receivePage(roomId, event.seq);
  });
  return {
    seq: Math.max(initialSeq, cursor.roomId === roomId ? cursor.seq : 0),
    receivePage,
  };
}
