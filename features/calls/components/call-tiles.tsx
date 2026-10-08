"use client";

import { useEffect, useRef } from "react";
import { MicOff } from "lucide-react";
import { cn } from "cn";
import type { CallParticipant, MediaTrack } from "../client/types";

export function CallVideo({
  track,
  label,
}: {
  track: MediaTrack;
  label: string;
}) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    track.attach(element);
    return () => track.detach(element);
  }, [track]);
  return (
    <video
      ref={video}
      autoPlay
      muted
      playsInline
      aria-label={label}
      className="h-full w-full object-contain"
    />
  );
}

function ParticipantTile({ person }: { person: CallParticipant }) {
  const camera = person.tracks.find(
    (track) => track.source === "camera" && track.kind === "video",
  );
  return (
    <section
      aria-label={`${person.name}${person.local ? ", 나" : ""}${person.speaking ? ", 말하는 중" : ""}`}
      className={cn(
        "relative flex aspect-video min-w-0 shrink-0 basis-full snap-center items-center justify-center overflow-hidden rounded-lg border-2 bg-muted md:basis-auto",
        person.speaking ? "border-primary" : "border-border",
      )}
    >
      {camera && person.cameraEnabled ? (
        <CallVideo track={camera} label={`${person.name} 영상`} />
      ) : (
        <span
          aria-hidden="true"
          className="flex size-20 items-center justify-center rounded-full bg-card text-3xl font-bold"
        >
          {Array.from(person.name)[0] ?? "?"}
        </span>
      )}
      <div className="absolute right-2 bottom-2 left-2 flex items-center gap-2 rounded-md bg-card px-2 py-1 text-sm">
        <span className="min-w-0 flex-1 truncate">
          {person.name}
          {person.local ? " (나)" : ""}
        </span>
        {!person.microphoneEnabled && (
          <MicOff className="size-4 shrink-0" aria-label="마이크 꺼짐" />
        )}
      </div>
    </section>
  );
}

export function CallTiles({
  participants,
}: {
  participants: readonly CallParticipant[];
}) {
  const sharing = participants.find(
    (person) =>
      person.screenShareEnabled &&
      person.tracks.some((track) => track.source === "screen_share"),
  );
  const screen = sharing?.tracks.find(
    (track) => track.source === "screen_share" && track.kind === "video",
  );
  const visible = participants.slice(0, 9);
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col gap-3 overflow-auto p-3 md:p-4",
        screen && "md:flex-row md:overflow-hidden",
      )}
    >
      {!participants.length && (
        <p className="m-auto text-sm text-muted-foreground">
          참가자 정보를 확인하고 있어요
        </p>
      )}
      {screen && sharing && (
        <section
          aria-label={`${sharing.name} 님의 화면 공유`}
          className="min-h-52 min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-muted md:min-h-0"
        >
          <CallVideo track={screen} label={`${sharing.name} 공유 화면`} />
        </section>
      )}
      <div
        className={cn(
          "contents",
          screen &&
            "md:flex md:min-h-0 md:w-52 md:shrink-0 md:flex-col md:gap-3 md:overflow-y-auto xl:w-60",
        )}
      >
        <div
          className={cn(
            "flex shrink-0 snap-x snap-mandatory gap-3 overflow-x-auto pb-2 md:grid md:overflow-visible",
            screen
              ? "md:flex md:flex-col"
              : visible.length <= 1
                ? "md:grid-cols-1"
                : visible.length <= 4
                  ? "md:grid-cols-2"
                  : "md:grid-cols-3",
          )}
        >
          {visible.map((person) => (
            <ParticipantTile key={person.participantId} person={person} />
          ))}
        </div>
        {participants.length > 9 && (
          <ul aria-label="다른 참가자" className="flex flex-wrap gap-2">
            {participants.slice(9).map((person) => (
              <li
                key={person.participantId}
                aria-label={`${person.name}${person.speaking ? ", 말하는 중" : ""}`}
                className={cn(
                  "flex items-center gap-2 rounded-full border-2 px-2 py-1 text-sm",
                  person.speaking ? "border-primary" : "border-border",
                )}
              >
                <span
                  aria-hidden="true"
                  className="flex size-8 items-center justify-center rounded-full bg-muted"
                >
                  {Array.from(person.name)[0]}
                </span>
                {person.name}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
