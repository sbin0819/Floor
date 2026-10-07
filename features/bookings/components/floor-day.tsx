"use client";

import { LockKeyhole } from "lucide-react";
import { useId } from "react";
import { cn } from "cn";
import { StatusBadge } from "@/components/status-badge";
import { amenityLabels, type AmenityKey } from "@/lib/spaces/amenities";
import {
  floorHref,
  formatAvailabilityUntil,
  spaceTypeLabels,
} from "@/features/bookings/format";
import { getOperatingWindow } from "@/features/bookings/operating-state";
import type {
  FloorDayData,
  FloorVisibleSpace,
  SpaceType,
} from "@/features/bookings/types";
import { localTime } from "@/lib/time/zoned";
import { useFloorSelection } from "./branch-workspace";
import { FloorNavigationLink } from "./floor-navigation-link";
import { AvailabilityBar } from "./availability-bar";

const types: SpaceType[] = [
  "meeting_room",
  "seminar",
  "phone_booth",
  "desk_area",
  "lounge",
];

function summaryText(space: FloorVisibleSpace, data: FloorDayData): string {
  if (!space.bookable)
    return space.deskCount > 0
      ? `좌석 ${space.deskCount}석 · 좌석 예약은 준비 중이에요`
      : "예약 없이 이용해요";
  if (!data.isToday) return `예약 ${space.bookingCount}건`;
  const summary = space.summary;
  if (!summary || summary.status === "outside_hours")
    return data.openHours ? `예약 ${space.bookingCount}건` : "쉬는 날";
  if (summary.status === "busy")
    return summary.availableAt
      ? `${localTime(new Date(summary.availableAt), data.branch.timezone)}부터 비어 있음`
      : "오늘은 빈 시간이 없어요";
  return formatAvailabilityUntil(
    summary.until,
    data.date,
    data.branch.timezone,
    { midnightAs24: summary.status !== "maintenance" },
  );
}

export function FloorDay({ data }: { data: FloorDayData }) {
  const headingId = useId();
  const selectedSpaceId = useFloorSelection()?.location.spaceId;
  const window = getOperatingWindow(
    data.date,
    data.branch.timezone,
    data.branch.openHours,
  );
  return (
    <section aria-label="공간 목록" className="space-y-7">
      {data.spaces.length === 0 && (
        <p className="py-8 text-muted-foreground">
          이 층에는 공간이 아직 없어요
        </p>
      )}
      {types.map((type) => {
        const rows = data.spaces
          .filter((space) => space.type === type)
          .sort((a, b) =>
            a.kind === b.kind
              ? a.kind === "accessible" && b.kind === "accessible"
                ? a.name.localeCompare(b.name, "ko")
                : 0
              : a.kind === "restricted"
                ? 1
                : -1,
          );
        if (!rows.length) return null;
        const group = data.groups.find((item) => item.type === type);
        const freeCount =
          data.isToday && data.operatingState.status === "open"
            ? group?.freeCount
            : null;
        return (
          <section
            key={type}
            className="space-y-3"
            aria-labelledby={`${headingId}-${type}`}
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <h2 id={`${headingId}-${type}`} className="font-semibold">
                {spaceTypeLabels[type]}
              </h2>
              <p className="text-sm text-muted-foreground tabular-nums">
                {group?.totalCount ?? rows.length}곳
                {freeCount && freeCount > 0
                  ? ` · 지금 ${freeCount}곳 비어 있음`
                  : ""}
              </p>
            </div>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {rows.map((space) => (
                <li key={space.id}>
                  {space.kind === "restricted" ? (
                    <p className="flex min-h-16 items-center gap-3 bg-muted/40 px-5 py-4 text-sm text-muted-foreground">
                      <LockKeyhole
                        className="size-4 shrink-0"
                        aria-hidden="true"
                      />
                      <span>
                        <span>전용 공간</span>
                        <span> · 다른 팀이 쓰는 공간이에요</span>
                      </span>
                    </p>
                  ) : (
                    <FloorNavigationLink
                      href={floorHref(
                        data.branch.id,
                        data.floor.id,
                        data.date,
                        space.id,
                      )}
                      location={{
                        floorId: data.floor.id,
                        date: data.date,
                        spaceId: space.id,
                      }}
                      aria-current={
                        selectedSpaceId === space.id ? "true" : undefined
                      }
                      className={cn(
                        "grid min-h-11 gap-3 border-l-2 px-5 py-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.8fr)] sm:items-center sm:gap-5",
                        selectedSpaceId === space.id
                          ? "border-l-primary bg-accent"
                          : "border-l-transparent hover:bg-muted/50",
                      )}
                    >
                      <div className="min-w-0 space-y-1">
                        <h3 className="font-semibold">{space.name}</h3>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {[
                            space.capacity === null
                              ? ""
                              : `최대 ${space.capacity}인`,
                            ...space.amenities
                              .map((key) => amenityLabels[key as AmenityKey])
                              .filter(Boolean),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      </div>
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                          {data.isToday && space.bookable && space.status && (
                            <StatusBadge status={space.status} />
                          )}
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {summaryText(space, data)}
                          </p>
                        </div>
                        {space.bookable && (
                          <AvailabilityBar
                            intervals={space.intervals}
                            window={window}
                            timeZone={data.branch.timezone}
                            now={data.isToday ? data.now : undefined}
                          />
                        )}
                      </div>
                    </FloorNavigationLink>
                  )}
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </section>
  );
}
