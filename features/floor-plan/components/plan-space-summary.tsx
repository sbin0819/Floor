"use client";

import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AvailabilityBar } from "@/features/bookings/components/availability-bar";
import { FloorNavigationLink } from "@/features/bookings/components/floor-navigation-link";
import { floorHref } from "@/features/bookings/format";
import { getSpaceDayStatusLine } from "@/features/bookings/space-status-line";
import { getOperatingWindow } from "@/features/bookings/operating-state";
import type { SpaceDayData } from "@/features/bookings/types";
import { amenityLabels, type AmenityKey } from "@/lib/spaces/amenities";

export function PlanSpaceSummary({
  data,
  now,
}: {
  data: SpaceDayData;
  now: string;
}) {
  const status = getSpaceDayStatusLine({ ...data, now });
  return (
    <section aria-label="공간 요약" className="space-y-4 overflow-y-auto p-5">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{data.space.name}</h2>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{status.label}</Badge>
          <Button asChild variant="ghost" size="icon">
            <FloorNavigationLink
              href={floorHref(
                data.branch.id,
                data.floor.id,
                data.date,
                undefined,
                "plan",
              )}
              location={{
                floorId: data.floor.id,
                date: data.date,
                spaceId: null,
                detail: false,
              }}
              replace
              aria-label="공간 상세 닫기"
            >
              <X aria-hidden="true" />
            </FloorNavigationLink>
          </Button>
        </div>
      </header>
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground tabular-nums">
        {data.space.capacity !== null && (
          <span>최대 {data.space.capacity}인</span>
        )}
        {data.space.amenities.map((key) => (
          <Badge key={key} variant="outline">
            {amenityLabels[key as AmenityKey]}
          </Badge>
        ))}
      </div>
      <AvailabilityBar
        intervals={[
          ...data.bookings.map(({ start, end, isMine }) => ({
            start,
            end,
            kind: isMine ? ("mine" as const) : ("other" as const),
          })),
          ...data.blocks.map(({ start, end }) => ({
            start,
            end,
            kind: "maintenance" as const,
          })),
        ]}
        window={getOperatingWindow(
          data.date,
          data.branch.timezone,
          data.branch.openHours,
        )}
        timeZone={data.branch.timezone}
        now={now}
      />
      {data.space.bookable ? (
        <Button asChild className="w-full">
          <FloorNavigationLink
            href={floorHref(
              data.branch.id,
              data.floor.id,
              data.date,
              data.space.id,
              "plan",
              true,
            )}
            location={{
              floorId: data.floor.id,
              date: data.date,
              spaceId: data.space.id,
              detail: true,
            }}
          >
            시간 고르고 예약하기
          </FloorNavigationLink>
        </Button>
      ) : (
        <p className="text-sm text-muted-foreground">예약 없이 쓰는 곳이에요</p>
      )}
    </section>
  );
}
