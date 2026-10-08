"use client";

import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
} from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useRealtimeChannel } from "@/components/realtime-provider";
import { roomChannel } from "@/lib/realtime/channels";
import type { RealtimeEvent } from "@/lib/realtime/types";
import { cn } from "cn";
import type { CallView } from "../types";
import type { CallTarget } from "../client/types";
import {
  CallFailureNotice,
  CallTargetSync,
  useCall,
  useHasCallProvider,
} from "./call-provider";
import { CallTiles } from "./call-tiles";
import { LiveCallControls } from "./live-call-controls";

type Changed = Extract<RealtimeEvent, { type: "call.changed" }>;
export function RoomCallBoundary(props: ComponentProps<typeof RoomCallArea>) {
  const available = useHasCallProvider();
  return available ? (
    <RoomCallArea {...props} />
  ) : (
    <div data-call-room className={roomClassName(props.compact)}>
      {props.children}
    </div>
  );
}
function roomClassName(compact = false) {
  return cn(
    "flex min-h-0 flex-col",
    compact
      ? "h-full"
      : "h-[calc(100dvh-3.5rem)] [body:has([data-mobile-call-panel])_&]:max-md:h-[calc(100dvh-3.5rem-8rem-env(safe-area-inset-bottom))]",
  );
}
export function RoomCallArea({
  target,
  initialCall,
  canCall,
  compact = false,
  children,
}: {
  target: CallTarget;
  initialCall: CallView | null;
  canCall: boolean;
  compact?: boolean;
  children: ReactNode;
}) {
  const active = useCall();
  const router = useRouter();
  const [eventState, setEvent] = useState<{
    base: CallView | null;
    event: Changed;
  } | null>(null);
  const [closedFor, setClosedFor] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [mobileChat, setMobileChat] = useState(false);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialRef = useRef(initialCall);
  useEffect(() => {
    initialRef.current = initialCall;
  }, [initialCall]);
  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = null;
    },
    [target.roomId],
  );
  useRealtimeChannel(roomChannel(target.roomId), (event) => {
    if (event.type !== "call.changed" || event.roomId !== target.roomId) return;
    setEvent({ base: initialRef.current, event });
    if (!refreshTimer.current)
      refreshTimer.current = setTimeout(() => {
        refreshTimer.current = null;
        router.refresh();
      }, 250);
  });
  const participantId =
    active.call?.roomId === target.roomId ? active.call.participantId : null;
  useEffect(() => {
    if (participantId) router.refresh();
  }, [participantId, router]);
  const changed =
    eventState?.base === initialCall &&
    eventState.event.roomId === target.roomId
      ? eventState.event
      : null;
  const snapshot = changed ? (changed.sessionId ? changed : null) : initialCall;
  const current = snapshot && snapshot.participantCount > 0 ? snapshot : null;
  const joined =
    participantId !== null &&
    ["connecting", "connected", "reconnecting"].includes(active.phase);
  const voice = target.roomKind === "voice";
  const showing = voice || (joined && closedFor !== participantId);
  const enter = () => {
    setClosedFor(null);
    setMobileChat(false);
    void active.join({
      ...target,
      ...(target.roomKind === "dm" && !current ? { ringing: true } : {}),
    });
  };
  return (
    <div data-call-room className={roomClassName(compact)}>
      <CallTargetSync target={target} />
      <div
        className={cn(
          "min-h-14 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-1",
          canCall || current || joined || voice ? "flex" : "hidden",
        )}
      >
        <Phone aria-hidden="true" className="size-4" />
        {current ? (
          <>
            <span className="text-sm tabular-nums">
              통화 중 · {current.participantCount}명
            </span>
            <span className="hidden items-center -space-x-1 sm:flex">
              {current.participants.slice(0, 3).map((person) => (
                <span
                  key={person.userId}
                  role="img"
                  aria-label={person.name}
                  className="flex size-7 items-center justify-center rounded-full border border-card bg-muted text-xs"
                >
                  {Array.from(person.name)[0]}
                </span>
              ))}
            </span>
          </>
        ) : (
          <span className="text-sm">{voice ? target.name : "통화"}</span>
        )}
        {!joined && canCall && (
          <Button variant="outline" className="ml-auto" onClick={enter}>
            {current || voice ? "참여" : "통화 시작"}
          </Button>
        )}
        {joined && !showing && (
          <Button
            variant="outline"
            className="ml-auto"
            onClick={() => {
              setClosedFor(null);
              setMobileChat(false);
            }}
          >
            통화 화면으로
          </Button>
        )}
        {joined && showing && !voice && (
          <Button
            variant="ghost"
            className="ml-auto"
            onClick={() => setClosedFor(participantId)}
          >
            통화 화면 닫기
          </Button>
        )}
        {showing && (
          <>
            <Button
              variant="ghost"
              className="xl:hidden"
              aria-pressed={mobileChat}
              onClick={() => setMobileChat((value) => !value)}
            >
              <MessageSquare aria-hidden="true" />
              {mobileChat ? "통화 보기" : "채팅 보기"}
            </Button>
            <Button
              variant="ghost"
              className="hidden xl:flex"
              aria-expanded={chatOpen}
              onClick={() => setChatOpen((value) => !value)}
            >
              {chatOpen ? "채팅 접기" : "채팅 열기"}
            </Button>
          </>
        )}
      </div>
      <div className="flex min-h-0 flex-1">
        {showing && (
          <section
            aria-label="통화 화면"
            className={cn(
              "min-w-0 flex-1 flex-col bg-card",
              mobileChat ? "hidden xl:flex" : "flex",
            )}
          >
            <div className="shrink-0 px-4 py-2">
              <CallFailureNotice />
            </div>
            {joined ? (
              <>
                <CallTiles participants={active.participants} />
                <div className="shrink-0 border-t border-border p-2">
                  <LiveCallControls />
                </div>
              </>
            ) : (
              <div className="m-auto space-y-4 p-6 text-center">
                <h1 className="text-xl font-bold">{target.name}</h1>
                <p className="text-sm text-muted-foreground tabular-nums">
                  {current
                    ? `${current.participantCount}명이 통화하고 있어요`
                    : "아직 통화 중인 사람이 없어요"}
                </p>
                {canCall ? (
                  <Button onClick={enter}>들어가기</Button>
                ) : (
                  <p>통화를 쓸 수 없어요</p>
                )}
              </div>
            )}
          </section>
        )}
        <div
          className={cn(
            "min-h-0 min-w-0 flex-col",
            !showing
              ? "flex flex-1"
              : mobileChat
                ? "flex flex-1 xl:w-[360px] xl:flex-none xl:border-l xl:border-border"
                : chatOpen
                  ? "hidden xl:flex xl:w-[360px] xl:flex-none xl:border-l xl:border-border"
                  : "hidden",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
