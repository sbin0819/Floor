"use client";

import Link from "next/link";
import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { PageContainer, PageHeading } from "@/components/page-container";
import { SpacePhoto } from "@/components/photos/space-photo";
import { SegmentedLink, SegmentedLinks } from "@/components/segmented-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SkeletonRegion } from "@/components/skeleton-region";
import { SkeletonRows } from "@/components/skeleton-shapes";
import {
  shouldInterceptNavigation,
  useOptimisticNavigation,
  type NavigateAction,
} from "@/components/optimistic-navigation";
import {
  floorHref,
  formatBookingDayHeading,
  formatBookingTime,
  relativeBookingStatus,
} from "@/features/bookings/format";
import type { MyBooking, MyBookingsData } from "@/features/bookings/types";
import { CancelBookingButton } from "./cancel-booking-button";
import { MyBookingsViewLinks } from "./my-bookings-view-links";

export type BookingHistoryTab = "upcoming" | "past";
function BookingList({
  bookings,
  upcoming,
  now,
}: {
  bookings: MyBooking[];
  upcoming: boolean;
  now: string;
}) {
  if (!bookings.length)
    return (
      <div className="space-y-3 rounded-xl border border-border bg-card p-5">
        <p className="text-sm text-muted-foreground">예약이 아직 없어요</p>
        <Link
          className="inline-flex min-h-11 items-center rounded-lg text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
          href="/booking"
        >
          공간 예약하기
        </Link>
      </div>
    );
  const groups = new Map<string, { title: string; bookings: MyBooking[] }>();
  for (const booking of bookings) {
    const key = `${booking.date}:${booking.timezone}`;
    const group = groups.get(key) ?? {
      title: formatBookingDayHeading(booking.date, now, booking.timezone),
      bookings: [],
    };
    group.bookings.push(booking);
    groups.set(key, group);
  }
  return (
    <div className="space-y-6">
      {[...groups].map(([key, group]) => (
        <section key={key} className="space-y-3">
          <h2 className="text-sm font-medium tabular-nums">{group.title}</h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {group.bookings.map((booking) => {
              const status = upcoming
                ? relativeBookingStatus(booking.start, booking.end, now)
                : booking.status === "cancelled"
                  ? "취소됨"
                  : "이용 종료";
              return (
                <li
                  key={booking.id}
                  className="flex flex-wrap items-center justify-between gap-4 p-5 has-[[data-cancelling=true]]:opacity-50"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <SpacePhoto
                      photo={booking.photo}
                      type={booking.spaceType}
                      decorative
                    />
                    <div className="min-w-0 space-y-2">
                      <p className="font-medium tabular-nums">
                        {formatBookingTime(
                          booking.start,
                          booking.end,
                          booking.timezone,
                        )}
                      </p>
                      <p className="font-medium">
                        {upcoming ? (
                          <Link
                            className="inline-flex min-h-11 items-center rounded-lg underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                            href={floorHref(
                              booking.branchId,
                              booking.floorId,
                              booking.date,
                              booking.spaceId,
                            )}
                          >
                            {booking.spaceName}
                          </Link>
                        ) : (
                          booking.spaceName
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {booking.branchName} · {booking.floorName} ·{" "}
                        {booking.teamName ?? "개인"}
                        {booking.title && ` · ${booking.title}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {booking.attendeeCount != null && (
                      <Badge variant="secondary" className="tabular-nums">
                        {booking.attendeeCount}명
                      </Badge>
                    )}
                    {status && (
                      <Badge
                        variant="secondary"
                        className={
                          status === "지금 이용 중"
                            ? "bg-status-mine text-status-mine-foreground"
                            : undefined
                        }
                      >
                        {status}
                      </Badge>
                    )}
                    {upcoming && <CancelBookingButton bookingId={booking.id} />}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function MyBookings({
  data,
  tab = "upcoming",
  navigateAction,
}: {
  data: MyBookingsData;
  tab?: BookingHistoryTab;
  navigateAction?: NavigateAction;
}) {
  const router = useRouter();
  const navigate = useCallback<NavigateAction>(
    (href) => router.push(href),
    [router],
  );
  const selection = useOptimisticNavigation(tab, navigateAction ?? navigate);
  const pending = selection.isPending && selection.value !== tab;
  return (
    <PageContainer as="main" className="space-y-6">
      <PageHeading
        title="내 예약"
        action={
          <Button asChild>
            <Link href="/booking">공간 예약하기</Link>
          </Button>
        }
      />
      <MyBookingsViewLinks view="list" />
      <SegmentedLinks label="예약 목록 선택">
        {(["upcoming", "past"] as const).map((value) => {
          const href = value === "past" ? "/bookings?tab=past" : "/bookings";
          return (
            <SegmentedLink
              key={value}
              asChild
              selected={selection.value === value}
            >
              <Link
                href={href}
                onClick={(event) => {
                  if (!shouldInterceptNavigation(event)) return;
                  event.preventDefault();
                  selection.change(value, href);
                }}
              >
                {value === "upcoming" ? (
                  <>
                    다가오는 예약{" "}
                    <span className="tabular-nums">{data.upcoming.length}</span>
                  </>
                ) : (
                  "지난 예약"
                )}
              </Link>
            </SegmentedLink>
          );
        })}
      </SegmentedLinks>
      {pending ? (
        <SkeletonRegion>
          <SkeletonRows count={3} action photo />
        </SkeletonRegion>
      ) : (
        <BookingList
          key={tab}
          bookings={tab === "past" ? data.past : data.upcoming}
          upcoming={tab === "upcoming"}
          now={data.now}
        />
      )}
    </PageContainer>
  );
}
