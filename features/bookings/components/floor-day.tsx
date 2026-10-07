"use client";

import { useId } from "react";
import { cn } from "cn";
import { StatusLine } from "@/components/status-line";
import { SpacePhoto } from "@/components/photos/space-photo";
import { amenityLabels, type AmenityKey } from "@/lib/spaces/amenities";
import { floorHref, spaceTypeLabels } from "@/features/bookings/format";
import { getOperatingWindow } from "@/features/bookings/operating-state";
import { getFloorSpaceStatusLine } from "@/features/bookings/space-status-line";
import type { FloorDayData, SpaceType } from "@/features/bookings/types";
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
              {rows.map((space) => {
                const status =
                  space.kind === "accessible"
                    ? getFloorSpaceStatusLine(data, space)
                    : null;
                return (
                  <li key={space.id}>
                    {space.kind === "restricted" ? (
                      <p className="flex min-h-16 items-center gap-3 bg-muted/40 px-5 py-4 text-sm text-muted-foreground">
                        <SpacePhoto
                          photo={null}
                          type={space.type}
                          size="fill"
                          className="h-11 w-14 md:h-[54px] md:w-[72px]"
                          restricted
                          decorative
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
                          "grid min-h-11 grid-cols-[56px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 border-l-[3px] px-4 py-4 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring md:grid-cols-[72px_minmax(0,1fr)_minmax(12rem,0.8fr)] md:gap-x-4 md:px-5",
                          selectedSpaceId === space.id
                            ? "border-l-primary bg-accent"
                            : "border-l-transparent hover:bg-muted/50",
                        )}
                      >
                        <SpacePhoto
                          photo={space.photo}
                          type={space.type}
                          size="fill"
                          sizes="(min-width: 768px) 72px, 56px"
                          className="col-start-1 row-start-1 row-end-4 h-11 w-14 self-start md:row-end-3 md:h-[54px] md:w-[72px]"
                          decorative
                        />
                        <h3 className="col-start-2 row-start-1 min-w-0 font-semibold">
                          {space.name}
                        </h3>
                        <p className="col-start-2 row-start-3 min-w-0 text-xs text-muted-foreground tabular-nums md:row-start-2">
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
                        {status && (
                          <StatusLine
                            kind={status.kind}
                            className="col-start-2 row-start-2 min-w-0 md:col-start-3 md:row-start-1"
                          >
                            {status.label}
                          </StatusLine>
                        )}
                        {space.bookable && (
                          <AvailabilityBar
                            intervals={space.intervals}
                            window={window}
                            timeZone={data.branch.timezone}
                            now={data.isToday ? data.now : undefined}
                            className="col-span-2 col-start-1 row-start-4 md:col-span-1 md:col-start-3 md:row-start-2"
                          />
                        )}
                      </FloorNavigationLink>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </section>
  );
}
