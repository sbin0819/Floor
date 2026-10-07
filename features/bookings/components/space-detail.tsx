"use client";

import { PhotoGallery } from "@/components/photos/photo-gallery";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { floorHref } from "@/features/bookings/format";
import { amenityLabels, type AmenityKey } from "@/lib/spaces/amenities";
import type { SpaceDayData } from "@/features/bookings/types";
import { BookingForm } from "./booking-form";
import { FloorNavigationLink } from "./floor-navigation-link";
import { useFloorView } from "./floor-view";
import { useWideScreen } from "./use-wide-screen";
import { useFloorSelection } from "./branch-workspace";
import { getSpaceDayStatusLine } from "@/features/bookings/space-status-line";
import { cn } from "@/lib/utils";
import { localDate } from "@/lib/time/zoned";

export function SpaceDetail({ data }: { data: SpaceDayData }) {
  const { effectiveView } = useFloorView();
  const wide = useWideScreen();
  const workspace = useFloorSelection();
  const status = getSpaceDayStatusLine(data);
  const isToday =
    data.date === localDate(new Date(data.now), data.branch.timezone);
  if (wide && effectiveView === "timeline")
    return (
      <BookingForm
        key={`${data.space.id}:${data.date}`}
        data={data}
        variant="strip"
        onBooked={() => workspace?.closeAfterBooking(data.space.id, data.date)}
      />
    );
  return (
    <section
      aria-label="공간 상세"
      className="flex h-full min-h-0 flex-col overflow-y-auto rounded-xl border border-border bg-card"
    >
      <div className="relative shrink-0">
        <PhotoGallery
          photos={data.photos}
          name={data.space.name}
          type={data.space.type}
          eager
          className="h-[160px] [@media(max-height:759px)]:h-[120px]"
          sizes="(max-width: 1023px) 100vw, 420px"
        />
        <Button
          asChild
          variant="outline"
          size="icon"
          className="absolute top-2 right-2 z-10 rounded-full bg-card"
        >
          <FloorNavigationLink
            href={floorHref(data.branch.id, data.floor.id, data.date)}
            location={{
              floorId: data.floor.id,
              date: data.date,
              spaceId: null,
            }}
            replace
            aria-label="공간 상세 닫기"
          >
            <X aria-hidden="true" />
          </FloorNavigationLink>
        </Button>
      </div>
      <header className="shrink-0 space-y-2 border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-bold">{data.space.name}</h2>
          {isToday && (
            <Badge
              className={cn(
                "border-0",
                status.kind === "free"
                  ? "bg-status-free text-status-free-foreground"
                  : status.kind === "mine"
                    ? "bg-accent text-accent-foreground"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {status.label}
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
          <span>
            {data.floor.level}층
            {data.space.capacity !== null && ` · 최대 ${data.space.capacity}인`}
          </span>
          {data.space.amenities.map((key) => (
            <Badge key={key} variant="outline" className="text-xs font-normal">
              {amenityLabels[key as AmenityKey]}
            </Badge>
          ))}
        </div>
      </header>
      <BookingForm key={`${data.space.id}:${data.date}`} data={data} />
    </section>
  );
}
