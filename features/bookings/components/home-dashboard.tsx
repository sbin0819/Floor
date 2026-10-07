import Link from "next/link";
import type { ReactNode } from "react";
import { ChevronRight, Plus } from "lucide-react";
import { PageHeading } from "@/components/page-container";
import { SpacePhoto } from "@/components/photos/space-photo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardContent } from "@/components/ui/card";
import { AvailabilityBar } from "./availability-bar";
import {
  floorHref,
  formatAvailabilityUntil,
  formatBookingDate,
  formatBookingTime,
} from "@/features/bookings/format";
import type {
  HomeHeaderData,
  HomeUpcomingBookingsData,
  HomeFreeSpacesData,
  HomeBookingLimitsData,
} from "@/features/bookings/types";
import type { HomeTeamsData } from "@/features/teams/types";
import { addDays, localDate, localTime } from "@/lib/time/zoned";
import { amenityLabels, type AmenityKey } from "@/lib/spaces/amenities";

const linkClass =
  "inline-flex min-h-11 items-center gap-1 rounded-lg text-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-ring";
const rowClass =
  "flex items-start gap-3 rounded-lg p-5 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring";

function HomeCard({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{title}</h2>
          {action}
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </section>
  );
}
function BookingLink() {
  return (
    <Link href="/booking" className={linkClass}>
      공간 예약하기
      <ChevronRight aria-hidden="true" className="size-4" />
    </Link>
  );
}

export function HomeHeader({ data }: { data: HomeHeaderData }) {
  const date = formatBookingDate(
    data.date,
    data.branch?.timezone ?? "Asia/Seoul",
  );
  const branchDescription = data.branch
    ? data.operatingState?.status === "open"
      ? `${data.branch.name}은 오늘 ${data.operatingState.hours?.close}까지 열어요`
      : `${data.branch.name}은 지금 운영 시간이 아니에요`
    : null;
  return (
    <PageHeading
      title={`안녕하세요, ${data.name}님`}
      description={
        <span className="tabular-nums">
          {date}
          {branchDescription && ` · ${branchDescription}`}
        </span>
      }
      action={
        <Button asChild>
          <Link href="/booking">
            <Plus aria-hidden="true" />
            공간 예약하기
          </Link>
        </Button>
      }
    />
  );
}

export function HomeUpcomingBookings({
  data,
}: {
  data: HomeUpcomingBookingsData;
}) {
  return (
    <HomeCard
      title="다가오는 내 예약"
      action={
        <Link className={linkClass} href="/bookings">
          내 예약 모두 보기
          <ChevronRight aria-hidden="true" className="size-4" />
        </Link>
      }
    >
      {data.bookings.length ? (
        <ul className="-mx-5 divide-y divide-border">
          {data.bookings.map((booking) => {
            const now = new Date(data.now);
            const today = localDate(now, booking.timezone);
            const current =
              Date.parse(booking.start) <= now.getTime() &&
              now.getTime() < Date.parse(booking.end);
            const dateLabel =
              booking.date === today
                ? null
                : `${booking.date === addDays(today, 1) ? "내일 · " : ""}${formatBookingDate(booking.date, booking.timezone)}`;
            return (
              <li key={booking.id}>
                <Link
                  className={rowClass}
                  href={floorHref(
                    booking.branchId,
                    booking.floorId,
                    booking.date,
                    booking.spaceId,
                  )}
                >
                  <SpacePhoto
                    photo={booking.photo}
                    type={booking.spaceType}
                    decorative
                  />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-3">
                      {current ? (
                        <Badge className="bg-status-mine text-status-mine-foreground">
                          지금 이용 중
                        </Badge>
                      ) : (
                        dateLabel && (
                          <span className="text-xs text-muted-foreground tabular-nums">
                            {dateLabel}
                          </span>
                        )
                      )}
                      <span className="font-medium tabular-nums">
                        {formatBookingTime(
                          booking.start,
                          booking.end,
                          booking.timezone,
                        )}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-medium">{booking.spaceName}</span>
                      <ChevronRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {booking.branchName} · {booking.floorName} ·{" "}
                      {booking.teamName ?? "개인"}
                      {booking.title && ` · ${booking.title}`}
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="space-y-3">
          <p className="text-muted-foreground">예약이 아직 없어요</p>
          <BookingLink />
        </div>
      )}
    </HomeCard>
  );
}

function NextOpening({ data }: { data: HomeFreeSpacesData }) {
  const next = data.operatingState?.nextOpening;
  if (!next || !data.branch)
    return (
      <>
        <p>운영 예정 시간이 없어요</p>
        <Link href="/branches" className={linkClass}>
          지점 바꾸기
        </Link>
      </>
    );
  const instant = new Date(next);
  const date = localDate(instant, data.branch.timezone);
  const label =
    date === data.date
      ? "오늘"
      : date === addDays(data.date, 1)
        ? "내일"
        : new Intl.DateTimeFormat("ko-KR", {
            timeZone: data.branch.timezone,
            weekday: "long",
          }).format(instant);
  return (
    <>
      <p className="tabular-nums">
        지금은 운영 시간이 아니에요. {label}{" "}
        {localTime(instant, data.branch.timezone)}에 열어요
      </p>
      <Link href="/booking" className={linkClass}>
        다른 날짜 보기
      </Link>
    </>
  );
}

export function HomeFreeSpaces({ data }: { data: HomeFreeSpacesData }) {
  const branch = data.branch;
  return (
    <HomeCard
      title={`지금 비어 있는 공간${branch ? ` · ${branch.name}` : ""}`}
      action={
        <Link href="/branches" className={linkClass}>
          지점 바꾸기
        </Link>
      }
    >
      {data.state === "no_branch" ? (
        <div className="space-y-3">
          <p>이용할 지점을 골라 주세요</p>
          <Link href="/branches" className={linkClass}>
            지점 고르기
          </Link>
        </div>
      ) : data.state === "no_floors" ? (
        <div className="space-y-3">
          <p>이 지점에는 이용할 수 있는 층이 아직 없어요</p>
          <Link href="/branches" className={linkClass}>
            지점 바꾸기
          </Link>
        </div>
      ) : data.state === "outside_hours" ? (
        <div className="space-y-3 text-muted-foreground">
          <NextOpening data={data} />
        </div>
      ) : (
        branch && (
          <>
            {data.spaces.length ? (
              <ul className="-mx-5 divide-y divide-border">
                {data.spaces.map((space) => (
                  <li key={space.id}>
                    <Link
                      className={rowClass}
                      href={floorHref(
                        branch.id,
                        space.floor.id,
                        data.date,
                        space.id,
                      )}
                    >
                      <SpacePhoto
                        photo={space.photo}
                        type={space.type}
                        decorative
                      />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                          <span className="font-medium">{space.name}</span>
                          <ChevronRight
                            aria-hidden="true"
                            className="size-4 text-muted-foreground"
                          />
                        </div>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {space.floor.name}
                          {space.capacity !== null &&
                            ` · 최대 ${space.capacity}인`}
                          {space.amenities
                            .map(
                              (key) => ` · ${amenityLabels[key as AmenityKey]}`,
                            )
                            .join("")}
                        </p>
                        {data.operatingState?.window && (
                          <AvailabilityBar
                            intervals={space.intervals}
                            window={data.operatingState.window}
                            now={data.now}
                            timeZone={branch.timezone}
                            showTicks={false}
                          />
                        )}
                        <p className="text-sm text-status-free-foreground tabular-nums">
                          {formatAvailabilityUntil(
                            space.freeUntil,
                            data.date,
                            branch.timezone,
                            { midnightAs24: true },
                          )}{" "}
                          비어 있음
                        </p>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="py-4 text-muted-foreground">
                지금 비어 있는 공간이 없어요
              </p>
            )}
            <footer className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
              <span className="tabular-nums">
                예약할 수 있는 공간 {data.totalCount}곳 중 {data.freeCount}곳이
                비어 있어요
              </span>
              <Link href={`/branches/${branch.id}`} className={linkClass}>
                {branch.name} 전체 보기
                <ChevronRight aria-hidden="true" className="size-4" />
              </Link>
            </footer>
          </>
        )
      )}
    </HomeCard>
  );
}

function minutesLabel(minutes: number) {
  return minutes % 60
    ? `${Math.floor(minutes / 60) ? `${Math.floor(minutes / 60)}시간 ` : ""}${minutes % 60}분`
    : `${minutes / 60}시간`;
}
export function HomeBookingLimits({
  data,
}: {
  data: HomeBookingLimitsData | null;
}) {
  if (!data) return null;
  const ratio =
    data.limitMinutes > 0
      ? Math.max(
          0,
          Math.min(100, (data.remainingMinutes / data.limitMinutes) * 100),
        )
      : 0;
  return (
    <HomeCard title="오늘 예약 한도">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3 tabular-nums">
          <strong className="font-semibold">
            {minutesLabel(data.remainingMinutes)} 남음
          </strong>
          <div
            role="meter"
            aria-label="오늘 남은 개인 예약 시간"
            aria-valuenow={data.remainingMinutes}
            aria-valuemin={0}
            aria-valuemax={data.limitMinutes}
            aria-valuetext={`${minutesLabel(data.remainingMinutes)} 남음`}
            className="h-2 min-w-16 flex-1 overflow-hidden rounded-full bg-muted"
          >
            <div
              className="h-full bg-status-mine-strong"
              style={{ width: `${ratio}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">
            하루 {minutesLabel(data.limitMinutes)}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          개인 예약 기준이에요. 팀 이름으로 예약하면 팀 한도를 써요.
        </p>
      </div>
    </HomeCard>
  );
}
export function HomeTeams({ data }: { data: HomeTeamsData }) {
  return (
    <HomeCard
      title="내 팀"
      action={
        <Link href="/teams" className={linkClass}>
          팀 관리
          <ChevronRight aria-hidden="true" className="size-4" />
        </Link>
      }
    >
      <div className="space-y-4">
        {data.pendingInviteCount > 0 && (
          <Link
            href="/teams"
            className="flex min-h-11 items-center justify-between gap-3 rounded-lg bg-status-pending p-3 text-status-pending-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="tabular-nums">
              받은 초대 {data.pendingInviteCount}개
            </span>
            <span>확인하기</span>
          </Link>
        )}
        {data.teams.length ? (
          <ul>
            {data.teams.map((team) => (
              <li key={team.id}>
                <Link
                  href={`/teams/${team.id}`}
                  className="flex min-h-11 items-center justify-between gap-4 rounded-lg py-2 hover:underline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span>{team.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {team.role === "admin" ? "팀 관리자" : "팀원"}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              아직 속한 팀이 없어요. 팀이 있으면 팀 전용 공간과 더 긴 예약
              시간을 쓸 수 있어요.
            </p>
            <Button asChild variant="outline" className="w-full">
              <Link href="/teams/start">팀 만들기 또는 가입</Link>
            </Button>
          </>
        )}
      </div>
    </HomeCard>
  );
}
