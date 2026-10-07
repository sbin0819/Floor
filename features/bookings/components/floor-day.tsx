"use client";

import { StatusBadge } from "@/components/status-badge";
import { amenityLabels, type AmenityKey } from "@/lib/spaces/amenities";
import { floorHref, spaceTypeLabels } from "@/features/bookings/format";
import type { FloorDayData, SpaceType } from "@/features/bookings/types";
import { useFloorSelection } from "./branch-workspace";
import { FloorNavigationLink } from "./floor-navigation-link";

const types: SpaceType[] = [
  "meeting_room",
  "seminar",
  "phone_booth",
  "desk_area",
  "lounge",
];
export function FloorDay({ data }: { data: FloorDayData }) {
  const selectedSpaceId = useFloorSelection()?.location.spaceId;
  return (
    <section aria-label="공간 목록" className="space-y-5">
      {data.spaces.length === 0 && (
        <p className="py-8 text-muted-foreground">
          이 층에는 공간이 아직 없어요
        </p>
      )}
      {types.map((type) => {
        const rows = data.spaces.filter((space) => space.type === type);
        if (!rows.length) return null;
        return (
          <section key={type} className="space-y-3">
            <h2 className="font-semibold">{spaceTypeLabels[type]}</h2>
            <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
              {rows.map((space) => (
                <li key={space.id}>
                  {space.kind === "restricted" ? (
                    <div className="p-5">
                      <StatusBadge status="restricted" />
                    </div>
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
                      className={`block min-h-11 space-y-2 p-5 focus-visible:outline-2 focus-visible:outline-ring ${selectedSpaceId === space.id ? "bg-accent" : "hover:bg-muted"}`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <h3 className="font-medium">{space.name}</h3>
                        {space.bookable && space.status && (
                          <StatusBadge status={space.status} />
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground tabular-nums">
                        {space.capacity !== null && `최대 ${space.capacity}인`}
                        {space.amenities.length > 0 &&
                          ` · ${space.amenities.map((key) => amenityLabels[key as AmenityKey]).join(" · ")}`}
                      </p>
                      <p className="text-sm tabular-nums">
                        {space.bookable
                          ? `예약 ${space.bookingCount}건`
                          : space.deskCount > 0
                            ? `좌석 ${space.deskCount}석 · 좌석 예약은 준비 중이에요`
                            : "예약 없이 이용해요"}
                      </p>
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
