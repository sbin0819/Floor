"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import {
  useRealtimeChannel,
  useRealtimeScope,
} from "@/components/realtime-provider";
import { roomChannel } from "@/lib/realtime/channels";
import { CHAT_NAV_KEY } from "../nav-state";

// 방 내용의 수명은 그대로 두고, 메타데이터 변경만 짧게 묶어 다시 읽는다.
export function useRoomRealtime(roomId: string) {
  const router = useRouter();
  const client = useQueryClient();
  const scope = useRealtimeScope();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
      timer.current = undefined;
    },
    [roomId],
  );
  useRealtimeChannel(roomChannel(roomId), (event) => {
    if (
      event.type !== "room.changed" ||
      event.roomId !== roomId ||
      timer.current
    )
      return;
    timer.current = setTimeout(() => {
      timer.current = undefined;
      void client.invalidateQueries({ queryKey: CHAT_NAV_KEY });
      router.refresh();
    }, 250);
  });
  return (
    scope.channels !== null &&
    scope.requestedRooms.includes(roomId) &&
    !scope.channels.includes(roomChannel(roomId))
  );
}
