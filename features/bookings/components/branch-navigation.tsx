"use client";

import Link from "next/link";
import { useEffect, type ReactNode } from "react";
import { useSearchParams, useSelectedLayoutSegments } from "next/navigation";
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
import { SpacePhoto } from "@/components/photos/space-photo";
import { SegmentedLink, SegmentedLinks } from "@/components/segmented-links";
import { StatusLine } from "@/components/status-line";
import { getBookingDateWindow } from "@/features/bookings/date";
import { floorHref, formatBookingDate } from "@/features/bookings/format";
import { getDisplayOperatingState } from "@/features/bookings/display-operating-state";
import { searchValue } from "@/features/bookings/floor-selection";
import type { BranchNavigationData } from "@/features/bookings/types";
import { getOpenHours } from "@/lib/time/open-hours";
import { zonedDateTime } from "@/lib/time/zoned";
import { useFloorSelection } from "./branch-workspace";
import { FloorNavigationLink } from "./floor-navigation-link";
import { FloorDatePicker } from "./floor-date-picker";
import { useBranchDisplayNow } from "./branch-display-clock";
import { floorIdFromSegments } from "./use-branch-route-scope";

export function BranchNavigation({
  data,
  viewControl,
}: {
  data: BranchNavigationData;
  viewControl?: ReactNode;
}) {
  const segments = useSelectedLayoutSegments();
  const currentSearch = useSearchParams();
  const navigation = useFloorSelection();
  const search = navigation?.search ?? currentSearch;
  const displayNow = useBranchDisplayNow({
    branchId: data.branch.id,
    now: data.now,
  });
  const registerNavigation = navigation?.registerNavigation;
  useEffect(
    () => registerNavigation?.(data.branch.id, data.today, data.now),
    [registerNavigation, data.branch.id, data.today, data.now],
  );
  const floorId = navigation?.location.floorId ?? floorIdFromSegments(segments);
  const dates = getBookingDateWindow(
    data.today,
    navigation?.location.date || searchValue(search, "date"),
  );
  const date = dates.selected;
  const requestedSpace = searchValue(search, "space");
  const requestedView = searchValue(search, "view");
  const selectedSpaceId = navigation
    ? (navigation.location.spaceId ?? undefined)
    : typeof requestedSpace === "string"
      ? requestedSpace
      : undefined;
  const view = typeof requestedView === "string" ? requestedView : undefined;
  const floor = data.floors.find(({ id }) => id === floorId);
  const display = getDisplayOperatingState({
    date,
    now: displayNow,
    timeZone: data.branch.timezone,
    openHours: data.branch.openHours,
  });
  const link = (value: string) =>
    floorHref(data.branch.id, floorId ?? "", value, selectedSpaceId, view);
  const location = (value: string) => ({
    floorId: floorId ?? "",
    date: value,
    spaceId: selectedSpaceId ?? null,
  });
  return (
    <PageContainer
      width="wide"
      className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-4 pb-6 lg:grid-cols-[auto_minmax(0,1fr)_auto_auto]"
    >
      <h1 className="sr-only">
        {floor ? `${floor.name} 공간 예약` : `${data.branch.name} 공간 예약`}
      </h1>
      <header className="contents">
        <div className="col-span-2 row-start-1 flex min-w-0 items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="max-w-[55vw] shrink-0 gap-2 text-base font-semibold lg:max-w-none lg:gap-3 lg:text-lg"
                aria-label={`${data.branch.name} · 지점 바꾸기`}
              >
                <SpacePhoto
                  photo={data.branch.cover}
                  type="branch"
                  size={{ width: 32, height: 24 }}
                  decorative
                />
                <span className="min-w-0 truncate">{data.branch.name}</span>
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
          <SegmentedLinks
            label="층 선택"
            className="min-w-0 flex-nowrap overflow-x-auto"
          >
            {data.floors.map((item) => (
              <SegmentedLink
                key={item.id}
                asChild
                selected={item.id === floorId}
                className="shrink-0"
              >
                <FloorNavigationLink
                  href={floorHref(
                    data.branch.id,
                    item.id,
                    date,
                    undefined,
                    view,
                  )}
                  location={{ floorId: item.id, date, spaceId: null }}
                  aria-current={item.id === floorId ? "page" : undefined}
                >
                  {item.name}
                </FloorNavigationLink>
              </SegmentedLink>
            ))}
          </SegmentedLinks>
        </div>
        <StatusLine
          kind={display.kind}
          aria-label="선택한 날짜 운영 시간"
          className="col-start-1 row-start-3 min-w-0 lg:col-start-3 lg:row-start-1"
        >
          {display.label}
        </StatusLine>
        {viewControl && (
          <div className="col-start-2 row-start-3 justify-self-end lg:col-start-4 lg:row-start-1">
            {viewControl}
          </div>
        )}
      </header>
      <div className="col-span-2 row-start-2 flex min-w-0 items-center gap-3 lg:col-span-4">
        {floorId && (
          <nav
            aria-label="날짜 선택"
            className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pb-1 tabular-nums lg:flex-none"
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
              const marked = data.bookingDates.includes(day);
              const label = `${day === data.today ? "오늘 · " : ""}${formatBookingDate(day, data.branch.timezone)}${closed ? " · 쉬는 날" : ""}${marked ? " · 내 예약 있음" : ""}`;
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
                  {marked && (
                    <span
                      aria-hidden="true"
                      className="size-1 rounded-full bg-primary"
                    />
                  )}
                </>
              );
              const className = cn(
                "h-16 min-w-11 flex-col gap-0.5 px-3",
                day === date
                  ? "border-primary bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground"
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
        {floorId && (
          <FloorDatePicker
            branchId={data.branch.id}
            floorId={floorId}
            date={date}
            today={data.today}
            timezone={data.branch.timezone}
            openHours={data.branch.openHours}
            bookingDates={data.bookingDates}
            spaceId={selectedSpaceId}
            view={view}
          />
        )}
        <div
          aria-label="공간 상태 범례"
          className="ml-auto hidden shrink-0 items-center gap-4 lg:flex"
        >
          {(!display.isToday || display.operating.status === "open") && (
            <StatusLine kind="free">비어 있음</StatusLine>
          )}
          <StatusLine kind="busy">예약됨</StatusLine>
          <StatusLine kind="mine">내 예약</StatusLine>
          <StatusLine kind="maintenance">점검</StatusLine>
        </div>
      </div>
    </PageContainer>
  );
}
