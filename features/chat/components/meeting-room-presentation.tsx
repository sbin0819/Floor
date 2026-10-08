"use client";

import {
  useId,
  useMemo,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import Link from "next/link";
import { CalendarDays, ChevronDown, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PersonCard } from "@/features/people/components/person-card";
import { PersonStatus } from "@/features/people/components/person-status";
import { cn } from "cn";
import type { MeetingView } from "../types";
import {
  meetingName,
  meetingPhase,
  meetingPhaseLabels,
  meetingTime,
} from "../meeting-format";
import { ChatMuteButton } from "./chat-mute-button";
import { MeetingCallButton } from "@/features/calls/components/meeting-call-button";
import type { CallTarget } from "@/features/calls/client/types";

export function MeetingHeader({
  data,
  compact,
  actions,
  trigger,
  membersOpen,
  membersId,
  onToggleMembers,
  fileAction,
}: {
  data: MeetingView;
  compact: boolean;
  actions?: ReactNode;
  trigger: RefObject<HTMLButtonElement | null>;
  membersOpen: boolean;
  membersId: string;
  onToggleMembers: () => void;
  fileAction?: ReactNode;
}) {
  const name = meetingName(data.booking);
  const Heading = compact ? "h2" : "h1";
  return (
    <header className="flex min-h-16 shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2 md:px-6">
      <CalendarDays
        aria-hidden="true"
        className="size-5 shrink-0 text-muted-foreground"
      />
      <Heading className="min-w-0 flex-1 truncate text-lg font-bold">
        {name}
      </Heading>
      <Badge variant="secondary">
        {meetingPhaseLabels[meetingPhase(data.booking, data.now)]}
      </Badge>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {fileAction}
        {compact ? (
          <span className="text-xs text-muted-foreground tabular-nums">
            멤버 {data.members.length}명
          </span>
        ) : (
          <Button
            ref={trigger}
            variant="ghost"
            aria-label={`멤버 ${data.members.length}명`}
            aria-expanded={membersOpen}
            aria-controls={membersId}
            onClick={onToggleMembers}
          >
            <Users aria-hidden="true" />
            <span className="tabular-nums">{data.members.length}</span>
          </Button>
        )}
        <ChatMuteButton id={data.room.id} name={name} muted={data.room.muted} />
        {actions}
      </div>
    </header>
  );
}

export function MeetingBookingCard({
  data,
  compact = false,
}: {
  data: MeetingView;
  compact?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const { booking, members } = data;
  const target = useMemo<CallTarget>(
    () => ({
      roomId: data.room.id,
      roomKind: "meeting",
      name: meetingName(booking),
      href: `/m/${booking.id}`,
      participants: data.call?.participants ?? [],
    }),
    [data.room.id, booking, data.call],
  );
  return (
    <section
      aria-label="예약 정보"
      className="shrink-0 border-b border-border bg-card px-4 py-3 md:px-6"
    >
      <Button
        variant="ghost"
        className={cn(
          "h-auto min-h-11 w-full min-w-0 justify-between gap-2 px-0 text-left",
          !compact && "md:hidden",
        )}
        aria-expanded={expanded}
        aria-controls={detailsId}
        onClick={() => setExpanded((value) => !value)}
      >
        <span className="min-w-0 truncate">
          {booking.spaceName} · {meetingTime(booking)}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn("size-4 shrink-0", expanded && "rotate-180")}
        />
      </Button>
      <div
        id={detailsId}
        className={cn(
          "flex flex-wrap items-center justify-between gap-3",
          !expanded && (compact ? "hidden" : "hidden md:flex"),
        )}
      >
        <div className="min-w-0 space-y-1">
          <p className="font-semibold">
            {booking.spaceName}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              {booking.branchName} · {booking.floorName}
            </span>
          </p>
          <p className="text-sm tabular-nums">
            {meetingTime(booking)}
            {booking.attendeeCount != null
              ? ` · ${booking.attendeeCount}명`
              : ""}
          </p>
          <div className="flex items-center gap-2 pt-1">
            <div className="flex -space-x-2" aria-label="회의 멤버">
              {members.slice(0, 5).map((member) => (
                <span
                  key={member.userId}
                  role="img"
                  aria-label={member.name}
                  className="flex size-8 items-center justify-center rounded-full border-2 border-card bg-muted text-xs font-semibold"
                >
                  {Array.from(member.name)[0]}
                </span>
              ))}
            </div>
            {members.length > 5 && (
              <span className="text-xs text-muted-foreground tabular-nums">
                +{members.length - 5}
              </span>
            )}
          </div>
        </div>
        {data.canCallAtStart && (
          <MeetingCallButton
            target={target}
            start={booking.start}
            end={booking.end}
            status={booking.status}
            now={data.now}
            enabled={data.canCallAtStart}
            eligible={data.canCallAtStart}
          />
        )}
        {data.canEditBooking && (
          <Button asChild variant="outline">
            <Link href={`/bookings/${booking.id}/edit`}>예약 바꾸기</Link>
          </Button>
        )}
      </div>
    </section>
  );
}

export function MeetingMembers({
  members,
}: {
  members: MeetingView["members"];
}) {
  return (
    <ul aria-label="회의 멤버 목록" className="space-y-3 p-4">
      {members.map((member) => (
        <li key={member.userId} className="flex min-h-11 items-center gap-2">
          <PersonCard userId={member.userId} name={member.name}>
            <button
              type="button"
              aria-label={`${member.name} 프로필`}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="relative flex size-9 shrink-0 items-center justify-center rounded-full bg-muted font-medium">
                <span aria-hidden="true">{Array.from(member.name)[0]}</span>
                <span className="absolute right-0 bottom-0">
                  <PersonStatus
                    userId={member.userId}
                    sharesSpace={member.sharesSpace}
                  />
                </span>
              </span>
              <span className="truncate text-sm">{member.name}</span>
            </button>
          </PersonCard>
          {member.isBooker && (
            <span className="shrink-0 rounded-sm border border-border px-1.5 py-0.5 text-xs text-muted-foreground">
              예약한 사람
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
