"use client";

import Link from "next/link";
import { useOptimistic, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { UserAvatar } from "@/components/user-avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CancelBookingButton } from "@/features/bookings/components/cancel-booking-button";
import {
  formatBookingDate,
  formatBookingTime,
} from "@/features/bookings/format";
import { DESK_SPLIT } from "@/features/bookings/desk-parts";
import { localDate, localTime } from "@/lib/time/zoned";
import { teamHref } from "../navigation";
import type { TeamBooking, TeamBookingsData } from "../types";
import { TeamTabSkeleton } from "./team-tab-skeleton";

function timeLabel(booking: TeamBooking) {
  if (booking.kind !== "desk")
    return formatBookingTime(booking.startAt, booking.endAt, booking.timezone);
  const start = localTime(new Date(booking.startAt), booking.timezone),
    end = localTime(new Date(booking.endAt), booking.timezone);
  return start >= DESK_SPLIT
    ? "오후"
    : end <= DESK_SPLIT &&
        localDate(new Date(booking.startAt), booking.timezone) ===
          localDate(new Date(booking.endAt), booking.timezone)
      ? "오전"
      : "종일";
}
export function TeamBookingRow({
  booking,
  now,
  upcoming,
}: {
  booking: TeamBooking;
  now: string;
  upcoming: boolean;
}) {
  const start = Date.parse(booking.startAt),
    end = Date.parse(booking.endAt),
    current = Date.parse(now);
  const status =
    !upcoming || current >= end
      ? null
      : current >= start
        ? "진행 중"
        : start - current <= 30 * 60_000
          ? "곧 시작"
          : null;
  return (
    <li className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4">
      <p className="min-w-24 font-semibold tabular-nums">
        {timeLabel(booking)}
      </p>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold break-words">
            {booking.title || booking.spaceName}
          </h3>
          {status && <Badge variant="secondary">{status}</Badge>}
        </div>
        <p className="text-sm text-muted-foreground">
          {booking.spaceName} · {booking.branchName} {booking.floorName}
          {booking.restricted ? " · 전용" : ""}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <UserAvatar
            avatar={booking.booker.avatar}
            name={booking.booker.name}
            size={24}
          />
          {booking.booker.name}
          <span className="tabular-nums">
            · 참석 {booking.participantCount}명
          </span>
        </p>
      </div>
      <div className="flex gap-1">
        {booking.canChat && (
          <Button asChild variant="outline">
            <Link href={`/m/${booking.id}`}>채팅</Link>
          </Button>
        )}
        {upcoming && booking.canCancel && (
          <CancelBookingButton bookingId={booking.id} />
        )}
      </div>
    </li>
  );
}
export function TeamBookings({ data }: { data: TeamBookingsData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selection, select] = useOptimistic({
    view: data.view,
    branchId: data.branchId,
  });
  const groups = new Map<
    string,
    { timezone: string; bookings: TeamBooking[] }
  >();
  for (const booking of data.bookings) {
    const date = localDate(new Date(booking.startAt), booking.timezone);
    const group = groups.get(date) ?? {
      timezone: booking.timezone,
      bookings: [],
    };
    group.bookings.push(booking);
    groups.set(date, group);
  }
  function navigate(value: typeof selection) {
    startTransition(() => {
      select(value);
      router.push(
        teamHref(data.teamId, {
          tab: "bookings",
          view: value.view,
          branch: value.branchId,
        }),
        {
          scroll: false,
        },
      );
    });
  }
  const loading =
    pending &&
    (selection.view !== data.view || selection.branchId !== data.branchId);
  const selectedBranch = data.branches.find(
    (branch) => branch.id === selection.branchId,
  );
  const missingBranch = selection.branchId !== null && !selectedBranch;
  return (
    <section className="space-y-5" aria-label="팀 예약">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="팀 예약 거르기"
          className="flex gap-1 rounded-lg bg-muted p-1"
        >
          {(
            [
              { value: "upcoming", label: "앞으로" },
              { value: "past", label: "지난 30일" },
              { value: "cancelled", label: "취소됨" },
            ] as const
          ).map(({ value, label }) => (
            <Link
              key={value}
              aria-current={selection.view === value ? "page" : undefined}
              href={teamHref(data.teamId, {
                tab: "bookings",
                view: value,
                branch: selection.branchId,
              })}
              className={`flex min-h-11 items-center rounded-md px-3 text-sm ${selection.view === value ? "bg-background font-semibold shadow-sm" : "text-muted-foreground"}`}
              onClick={(event) => {
                if (
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.altKey ||
                  event.shiftKey
                )
                  return;
                event.preventDefault();
                navigate({ ...selection, view: value });
              }}
            >
              {label}
            </Link>
          ))}
        </nav>
        <Select
          value={selection.branchId ?? "all"}
          onValueChange={(value) =>
            navigate({ ...selection, branchId: value === "all" ? null : value })
          }
        >
          <SelectTrigger aria-label="지점 거르기" className="min-w-40">
            <SelectValue>
              {selectedBranch?.name ??
                (missingBranch ? "선택한 지점을 찾을 수 없어요" : "모든 지점")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">모든 지점</SelectItem>
            {missingBranch && (
              <SelectItem value={selection.branchId!} disabled>
                선택한 지점을 찾을 수 없어요
              </SelectItem>
            )}
            {data.branches.map((branch) => (
              <SelectItem key={branch.id} value={branch.id}>
                {branch.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {loading && <TeamTabSkeleton tab="bookings" />}
      <div hidden={loading} className="space-y-6">
        {groups.size ? (
          [...groups].map(([date, group]) => (
            <section key={date} className="space-y-3">
              <h2 className="text-sm font-semibold tabular-nums">
                {formatBookingDate(date, group.timezone)}
              </h2>
              <ul className="space-y-3">
                {group.bookings.map((booking) => (
                  <TeamBookingRow
                    key={booking.id}
                    booking={booking}
                    now={data.now}
                    upcoming={data.view === "upcoming"}
                  />
                ))}
              </ul>
            </section>
          ))
        ) : (
          <div className="space-y-4 rounded-xl border bg-card p-10 text-center">
            <p>팀 이름으로 잡은 예약이 없어요</p>
            <Button asChild variant="outline">
              <Link href="/booking">공간 예약하기</Link>
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
