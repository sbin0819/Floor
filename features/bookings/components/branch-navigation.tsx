"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PageContainer } from "@/components/page-container";
import { getBookingDateWindow } from "@/features/bookings/date";
import { floorHref, formatBookingDate } from "@/features/bookings/format";
import { getOperatingState } from "@/features/bookings/operating-state";
import { searchValue } from "@/features/bookings/floor-selection";
import type { BranchNavigationData } from "@/features/bookings/types";
import { getOpenHours } from "@/lib/time/open-hours";
import { zonedDateTime } from "@/lib/time/zoned";
import { useFloorSelection } from "./branch-workspace";
import { FloorNavigationLink } from "./floor-navigation-link";

export function BranchNavigation({ data }: { data: BranchNavigationData }) {
  const params = useParams<{ floorId?: string }>();
  const search = useSearchParams();
  const navigation = useFloorSelection();
  const registerNavigation = navigation?.registerNavigation;
  useEffect(
    () => registerNavigation?.(data.branch.id, data.today, data.now),
    [registerNavigation, data.branch.id, data.today, data.now],
  );
  const floorId = navigation?.location.floorId || params.floorId?.toLowerCase();
  const dates = getBookingDateWindow(
    data.today,
    navigation?.location.date || searchValue(search, "date"),
  );
  const date = dates.selected;
  const selectedSpaceId = navigation?.location.spaceId ?? undefined;
  const floor = data.floors.find(({ id }) => id === floorId);
  const hours = getOpenHours(data.branch.openHours, date);
  const operating = getOperatingState(
    new Date(data.now),
    data.branch.timezone,
    data.branch.openHours,
  );
  const todayStatus =
    operating.status === "open"
      ? "영업 중"
      : operating.status === "before_open"
        ? "영업 전"
        : "영업 종료";
  const hoursLabel = !hours
    ? "쉬는 날"
    : `${date === data.today ? `${todayStatus} · ` : ""}${hours.open}–${hours.close}`;
  const link = (value: string) =>
    floorHref(data.branch.id, floorId ?? "", value, selectedSpaceId);
  const location = (value: string) => ({
    floorId: floorId ?? "",
    date: value,
    spaceId: selectedSpaceId ?? null,
  });
  return (
    <PageContainer width="wide" className="space-y-5 pb-6">
      <h1 className="sr-only">
        {floor ? `${floor.name} 공간 예약` : `${data.branch.name} 공간 예약`}
      </h1>
      <header className="flex flex-wrap items-center gap-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="gap-3 text-lg font-semibold"
              aria-label={`${data.branch.name} · 지점 바꾸기`}
            >
              {data.branch.name}
              <ChevronDown
                aria-hidden="true"
                className="size-4 text-muted-foreground"
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="min-w-48">
            {data.branches.map((branch) => (
              <DropdownMenuItem
                asChild
                key={branch.id}
                className="min-h-11 px-3"
              >
                <Link
                  href={`/branches/${branch.id}`}
                  aria-current={
                    branch.id === data.branch.id ? "true" : undefined
                  }
                >
                  {branch.name}
                </Link>
              </DropdownMenuItem>
            ))}
            {data.branches.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem asChild className="min-h-11 px-3">
              <Link href="/branches">모든 지점 보기</Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <p
          className="text-sm text-muted-foreground tabular-nums"
          aria-label="선택한 날짜 운영 시간"
        >
          {hoursLabel}
        </p>
      </header>
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <nav
          aria-label="층 선택"
          className="flex w-fit flex-wrap gap-1 rounded-xl bg-muted p-1"
        >
          {data.floors.map((item) => (
            <Button
              key={item.id}
              asChild
              variant={item.id === floorId ? "secondary" : "ghost"}
            >
              <FloorNavigationLink
                href={floorHref(data.branch.id, item.id, date)}
                location={{ floorId: item.id, date, spaceId: null }}
                aria-current={item.id === floorId ? "page" : undefined}
              >
                {item.name}
              </FloorNavigationLink>
            </Button>
          ))}
        </nav>
        {floorId && (
          <nav
            aria-label="날짜 선택"
            className="flex min-w-0 items-center gap-2 overflow-x-auto pb-1 tabular-nums"
          >
            {dates.previous ? (
              <Button asChild variant="outline" size="icon">
                <FloorNavigationLink
                  href={link(dates.previous)}
                  location={location(dates.previous)}
                  aria-label="이전 7일"
                >
                  <ChevronLeft aria-hidden="true" />
                </FloorNavigationLink>
              </Button>
            ) : (
              <Button
                variant="outline"
                size="icon"
                disabled
                aria-label="이전 7일"
              >
                <ChevronLeft aria-hidden="true" />
              </Button>
            )}
            {dates.days.map(({ date: day, disabled }) => {
              const closed = getOpenHours(data.branch.openHours, day) === null;
              const weekday = new Intl.DateTimeFormat("ko-KR", {
                timeZone: data.branch.timezone,
                weekday: "short",
              }).format(zonedDateTime(day, "12:00", data.branch.timezone));
              const label = `${day === data.today ? "오늘 · " : ""}${formatBookingDate(day, data.branch.timezone)}${closed ? " · 쉬는 날" : ""}`;
              const content = (
                <>
                  <span className="text-xs font-normal">
                    {day === data.today ? "오늘" : weekday}
                  </span>
                  <span className="text-base font-semibold">
                    {Number(day.slice(-2))}
                  </span>
                  {closed && (
                    <span className="text-[10px] leading-none font-normal">
                      쉬는 날
                    </span>
                  )}
                </>
              );
              const className = cn(
                "h-14 min-w-11 flex-col gap-0.5 px-3",
                day === date
                  ? "border-foreground bg-foreground text-background hover:bg-foreground hover:text-background"
                  : closed && "text-muted-foreground",
              );
              return disabled ? (
                <Button
                  key={day}
                  variant="outline"
                  className={className}
                  disabled
                  aria-label={label}
                >
                  {content}
                </Button>
              ) : (
                <Button
                  key={day}
                  asChild
                  variant="outline"
                  className={className}
                >
                  <FloorNavigationLink
                    href={link(day)}
                    location={location(day)}
                    aria-label={label}
                    aria-current={day === date ? "date" : undefined}
                  >
                    {content}
                  </FloorNavigationLink>
                </Button>
              );
            })}
            {dates.next ? (
              <Button asChild variant="outline" size="icon">
                <FloorNavigationLink
                  href={link(dates.next)}
                  location={location(dates.next)}
                  aria-label="다음 7일"
                >
                  <ChevronRight aria-hidden="true" />
                </FloorNavigationLink>
              </Button>
            ) : (
              <Button
                variant="outline"
                size="icon"
                disabled
                aria-label="다음 7일"
              >
                <ChevronRight aria-hidden="true" />
              </Button>
            )}
          </nav>
        )}
      </div>
      {floorId && !hours && (
        <p
          role="status"
          className="rounded-lg border border-border bg-muted p-4"
        >
          쉬는 날이에요. 다른 날짜를 골라 주세요
        </p>
      )}
    </PageContainer>
  );
}
