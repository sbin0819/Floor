"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { useRealtimePresence } from "@/components/realtime-provider";
import { roomChannel } from "@/lib/realtime/channels";
import { createTypingState } from "../typing";

const emptySnapshot = () => "";

export function useTyping({
  roomId,
  user,
  members,
  enabled = true,
}: {
  roomId: string;
  user: { id: string; name: string };
  members: readonly { id: string; name: string }[];
  enabled?: boolean;
}) {
  const state = useMemo(
    () =>
      createTypingState({
        roomId,
        user: { id: user.id, name: user.name },
        members: [],
        publish: () => {},
      }),
    [roomId, user.id, user.name],
  );
  const update = useRealtimePresence(
    enabled ? roomChannel(roomId) : null,
    state.receive,
  );
  useEffect(() => {
    state.setPublisher(enabled ? update : () => {});
    if (!enabled) state.stopTyping();
  }, [enabled, state, update]);
  useEffect(() => {
    state.setMembers(members);
  }, [state, members]);
  useEffect(() => {
    state.activate();
    return () => state.dispose();
  }, [state]);
  const label = useSyncExternalStore(
    state.subscribe,
    state.getSnapshot,
    emptySnapshot,
  );
  return { label, onInput: state.onInput, stopTyping: state.stopTyping };
}
