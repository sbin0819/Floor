"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/page-container";
import { normalizeBookingDateForToday } from "@/features/bookings/date";
import { floorHref, formatBookingDate } from "@/features/bookings/format";
import { searchValue } from "@/features/bookings/floor-selection";
import type { BranchNavigationData } from "@/features/bookings/types";
import { getOpenHours } from "@/lib/time/open-hours";
import { addDays } from "@/lib/time/zoned";
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
  const date =
    navigation?.location.date ||
    normalizeBookingDateForToday(searchValue(search, "date"), data.today);
  const selectedSpaceId = navigation?.location.spaceId ?? undefined;
  const floor = data.floors.find(({ id }) => id === floorId);
  const hours = getOpenHours(data.branch.openHours, date);
  const link = (value: string) =>
    floorHref(data.branch.id, floorId ?? "", value, selectedSpaceId);
  const location = (value: string) => ({
    floorId: floorId ?? "",
    date: value,
    spaceId: selectedSpaceId ?? null,
  });
  return (
    <PageContainer width="wide" className="space-y-6 pb-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            className="inline-flex min-h-11 items-center rounded-lg text-sm text-muted-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
            href="/branches"
          >
            {data.branch.name} · 지점 바꾸기
          </Link>
          <h1 className="text-2xl font-semibold">
            {floor ? `${floor.name} 공간 예약` : data.branch.name}
          </h1>
          {floorId && (
            <p
              className="text-sm text-muted-foreground tabular-nums"
              aria-label="선택한 날짜 운영 시간"
            >
              {hours ? `${hours.open}–${hours.close}` : "쉬는 날"}
            </p>
          )}
        </div>
        {floorId && (
          <nav
            aria-label="날짜 선택"
            className="flex flex-wrap items-center gap-2 tabular-nums"
          >
            {date > data.today ? (
              <Button asChild variant="outline">
                <FloorNavigationLink
                  href={link(addDays(date, -1))}
                  location={location(addDays(date, -1))}
                >
                  이전 날
                </FloorNavigationLink>
              </Button>
            ) : (
              <Button variant="outline" disabled>
                이전 날
              </Button>
            )}
            <span className="px-2">
              {formatBookingDate(date, data.branch.timezone)}
            </span>
            {date < addDays(data.today, 60) ? (
              <Button asChild variant="outline">
                <FloorNavigationLink
                  href={link(addDays(date, 1))}
                  location={location(addDays(date, 1))}
                >
                  다음 날
                </FloorNavigationLink>
              </Button>
            ) : (
              <Button variant="outline" disabled>
                다음 날
              </Button>
            )}
            <Button asChild variant="ghost">
              <FloorNavigationLink
                href={link(data.today)}
                location={location(data.today)}
                aria-current={date === data.today ? "date" : undefined}
              >
                오늘
              </FloorNavigationLink>
            </Button>
          </nav>
        )}
      </header>
      <nav aria-label="층 선택" className="flex flex-wrap gap-2">
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
