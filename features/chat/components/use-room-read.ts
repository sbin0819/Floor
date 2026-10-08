"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { markRoomRead } from "@/features/chat/actions";
import type { ActionResult } from "@/lib/actions/result";
import { clearRoomUnread } from "../nav-state";

export type MarkRoomRead = (input: {
  roomId: string;
  seq: number;
}) => Promise<ActionResult<{ lastReadSeq: number }>>;

export function useRoomRead({
  roomId,
  visibleSeq,
  knownReadSeq,
  blocked,
  mark = markRoomRead,
}: {
  roomId: string;
  visibleSeq: number | null;
  knownReadSeq: number | null;
  blocked: boolean;
  mark?: MarkRoomRead;
}) {
  const client = useQueryClient();
  const { mutateAsync } = useMutation({
    mutationKey: ["chat", "read", roomId],
    scope: { id: `chat-read:${roomId}` },
    mutationFn: (input: { roomId: string; seq: number }) => mark(input),
    networkMode: "always",
    retry: false,
  });
  const cursorRef = useRef({
    roomId,
    known: 0,
    attempted: -1,
    pending: false,
    active: true,
  });
  const [revision, setRevision] = useState(0);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  useEffect(() => {
    if (cursorRef.current.roomId !== roomId)
      cursorRef.current = {
        roomId,
        known: 0,
        attempted: -1,
        pending: false,
        active: true,
      };
    const cursor = cursorRef.current;
    cursor.active = true;
    return () => {
      cursor.active = false;
      cursor.attempted = cursor.known;
    };
  }, [roomId]);
  useEffect(() => {
    const cursor = cursorRef.current;
    cursor.known = Math.max(cursor.known, knownReadSeq ?? 0);
    // 실패 직후에는 반복하지 않고, 사용자가 다시 보러 왔을 때만 재시도한다.
    if (!visible || visibleSeq === null) cursor.attempted = cursor.known;
    if (
      !visible ||
      blocked ||
      visibleSeq === null ||
      visibleSeq <= cursor.known ||
      visibleSeq <= cursor.attempted ||
      cursor.pending
    )
      return;
    const timer = setTimeout(() => {
      if (document.visibilityState !== "visible" || !cursor.active) return;
      cursor.pending = true;
      cursor.attempted = visibleSeq;
      clearRoomUnread(client, roomId, visibleSeq);
      void mutateAsync({ roomId, seq: visibleSeq })
        .then((result) => {
          if (result.ok)
            cursor.known = Math.max(cursor.known, result.data.lastReadSeq);
        })
        .catch(() => {
          // 실패한 낙관 표시는 다음 목록 조회가 맞춘다. 원문 예외는 출력하지 않는다.
        })
        .finally(() => {
          cursor.pending = false;
          if (cursor.active) setRevision((value) => value + 1);
        });
    }, 1_000);
    return () => clearTimeout(timer);
  }, [
    blocked,
    client,
    knownReadSeq,
    mutateAsync,
    revision,
    roomId,
    visible,
    visibleSeq,
  ]);
}
