"use client";

import { useEffect, useState } from "react";
import { useRealtimeChannel } from "@/components/realtime-provider";
import { userChannel } from "@/lib/realtime/channels";
import { useCall } from "./call-provider";

export function CallingStatusMessage({
  name,
  unanswered,
}: {
  name: string;
  unanswered: boolean;
}) {
  return (
    <p
      role="status"
      className="fixed inset-x-0 top-14 z-[46] border-b bg-muted px-4 py-2 text-sm md:left-[72px] xl:left-[320px]"
    >
      {unanswered ? "받지 않았어요" : `${name} 님을 부르고 있어요`}
    </p>
  );
}

export function CallingStatus({ userId }: { userId: string }) {
  const { call, participants } = useCall();
  if (!call || call.roomKind !== "dm" || !call.ringing) return null;
  const peer = call.participants.find((person) => person.userId !== userId);
  if (!peer) return null;
  return (
    <SessionCallingStatus
      key={call.sessionId}
      userId={userId}
      peerId={peer.userId}
      name={peer.name}
      roomId={call.roomId}
      sessionId={call.sessionId}
      joinedAt={call.joinedAt}
      peerPresent={participants.some((person) => person.userId === peer.userId)}
    />
  );
}

function SessionCallingStatus({
  userId,
  peerId,
  name,
  roomId,
  sessionId,
  joinedAt,
  peerPresent,
}: {
  userId: string;
  peerId: string;
  name: string;
  roomId: string;
  sessionId: string;
  joinedAt: number;
  peerPresent: boolean;
}) {
  const [answered, setAnswered] = useState(peerPresent);
  const [unanswered, setUnanswered] = useState(false);
  if (peerPresent && !answered) setAnswered(true);
  useEffect(() => {
    if (answered) return;
    const timer = setTimeout(
      () => setUnanswered(true),
      Math.max(0, joinedAt + 30_000 - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [joinedAt, answered]);
  useRealtimeChannel(userChannel(userId), (event) => {
    if (
      event.type === "call.declined" &&
      event.roomId === roomId &&
      event.sessionId === sessionId
    )
      setUnanswered(true);
    if (
      event.type === "call.changed" &&
      event.roomId === roomId &&
      (event.sessionId === null ||
        (event.sessionId === sessionId &&
          event.participants.some((person) => person.userId === peerId)))
    )
      setAnswered(true);
  });
  if (answered || peerPresent) return null;
  return <CallingStatusMessage name={name} unanswered={unanswered} />;
}
