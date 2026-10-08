import type { PresenceMember } from "@/lib/realtime/ably-browser-client";

export type TypingData = { typing: boolean; name?: string };
type Member = { id: string; name: string };

export function typingLabel(names: readonly string[]) {
  if (!names.length) return "";
  if (names.length >= 3) return "여러 명이 입력하고 있어요";
  return `${names.join(", ")} 님이 입력하고 있어요`;
}

export function createTypingState({
  roomId,
  user,
  members: initialMembers,
  publish: initialPublish,
  now = Date.now,
}: {
  roomId: string;
  user: Member;
  members: readonly Member[];
  publish: (data: TypingData) => void;
  now?: () => number;
}) {
  let publish = initialPublish;
  let members = initialMembers;
  let present: readonly PresenceMember[] = [];
  let snapshot = "";
  let active = true;
  let typing = false;
  let lastSent = -Infinity;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let throttle: ReturnType<typeof setTimeout> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  function refresh() {
    if (!active) return;
    clearTimeout(expiry);
    const time = now();
    const names = new Map(members.map((member) => [member.id, member.name]));
    const typists = new Set<string>();
    let nextExpiry = Infinity;
    for (const member of present) {
      if (member.clientId === user.id || !names.has(member.clientId)) continue;
      if (
        !member.data ||
        typeof member.data !== "object" ||
        !("typing" in member.data) ||
        member.data.typing !== true
      )
        continue;
      const until = member.timestamp + 7_000;
      if (!Number.isFinite(until) || until <= time) continue;
      typists.add(member.clientId);
      nextExpiry = Math.min(nextExpiry, until);
    }
    const next = typingLabel([...typists].map((id) => names.get(id)!));
    if (snapshot !== next) {
      snapshot = next;
      for (const notify of listeners) notify();
    }
    if (nextExpiry !== Infinity)
      expiry = setTimeout(refresh, nextExpiry - time);
  }

  function sendTyping() {
    throttle = undefined;
    if (!active || !typing) return;
    lastSent = now();
    publish({ typing: true, name: user.name });
  }

  function stopTyping() {
    clearTimeout(idle);
    clearTimeout(throttle);
    idle = undefined;
    throttle = undefined;
    if (!active || !typing) return;
    typing = false;
    publish({ typing: false });
  }

  return {
    roomId,
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onInput(body: string) {
      if (!active) return;
      if (!body.trim()) return stopTyping();
      typing = true;
      clearTimeout(idle);
      idle = setTimeout(stopTyping, 5_000);
      if (throttle) return;
      const delay = 3_000 - (now() - lastSent);
      if (delay <= 0) sendTyping();
      else throttle = setTimeout(sendTyping, delay);
    },
    stopTyping,
    receive(next: readonly PresenceMember[]) {
      present = next;
      refresh();
    },
    setMembers(next: readonly Member[]) {
      members = next;
      refresh();
    },
    setPublisher(next: (data: TypingData) => void) {
      publish = next;
    },
    activate() {
      active = true;
      refresh();
    },
    dispose() {
      active = false;
      typing = false;
      present = [];
      snapshot = "";
      clearTimeout(idle);
      clearTimeout(throttle);
      clearTimeout(expiry);
      listeners.clear();
    },
  };
}
