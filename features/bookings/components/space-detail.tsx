"use client";

import { useEffect, useRef } from "react";
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
import { useBranchDisplayNow } from "./branch-display-clock";
import { hasDeskSeats, spaceDetailMode } from "../space-detail-mode";
import { DeskPicker } from "./desk-picker";
import { SpaceDetailLoading } from "./space-detail-loading";
import { PlanSpaceSummary } from "@/features/floor-plan/components/plan-space-summary";

export function SpaceDetail({ data }: { data: SpaceDayData }) {
  const { effectiveView } = useFloorView();
  const wide = useWideScreen();
  const workspace = useFloorSelection();
  const floorSpace = workspace?.floorData?.spaces.find(
    (space) =>
      space.kind === "accessible" && space.id === workspace.location.spaceId,
  );
  const displayNow = useBranchDisplayNow({
    branchId: data.branch.id,
    now: data.now,
  });
  const { mode, keepSpaceOnClose } = spaceDetailMode({
    wide,
    view: effectiveView,
    detail: workspace?.location.detail === true,
    space: floorSpace?.kind === "accessible" ? floorSpace : null,
  });
  const rightDetail = mode === "detail";
  const isDesk = hasDeskSeats(data.space) && data.desk !== null;
  const compact =
    !wide && effectiveView === "plan" && !isDesk && !workspace?.location.detail;
  const title = useRef<HTMLHeadingElement>(null);
  const previousSummary = useRef<string | null>(null);
  const scope = `${data.branch.id}:${data.floor.id}:${data.date}:${data.space.id}`;
  useEffect(() => {
    if (
      !compact &&
      !wide &&
      effectiveView === "plan" &&
      previousSummary.current === scope
    )
      title.current?.focus();
    previousSummary.current = compact ? scope : null;
  }, [compact, wide, effectiveView, scope]);
  const status = getSpaceDayStatusLine({ ...data, now: displayNow });
  const isToday =
    data.date === localDate(new Date(displayNow), data.branch.timezone);
  if (isDesk && workspace && !floorSpace) return <SpaceDetailLoading />;
  if (compact) return <PlanSpaceSummary data={data} now={displayNow} />;
  if (mode === "strip")
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
          className={
            rightDetail
              ? "h-[220px] [@media(max-height:759px)]:h-[160px]"
              : "h-[160px] [@media(max-height:759px)]:h-[120px]"
          }
          sizes="(max-width: 1023px) 100vw, 420px"
        />
        <Button
          asChild
          variant="outline"
          size="icon"
          className="absolute top-2 right-2 z-10 rounded-full bg-card"
        >
          <FloorNavigationLink
            href={floorHref(
              data.branch.id,
              data.floor.id,
              data.date,
              keepSpaceOnClose ? data.space.id : undefined,
            )}
            location={{
              floorId: data.floor.id,
              date: data.date,
              spaceId: keepSpaceOnClose ? data.space.id : null,
              detail: false,
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
          <h2
            ref={title}
            tabIndex={-1}
            className="text-lg font-bold focus-visible:outline-2 focus-visible:outline-ring"
          >
            {data.space.name}
          </h2>
          {isToday && !isDesk && (
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
            {isDesk
              ? ` · ${data.space.deskCount}석`
              : data.space.capacity !== null &&
                ` · 최대 ${data.space.capacity}인`}
          </span>
          {data.space.amenities.map((key) => (
            <Badge key={key} variant="outline" className="text-xs font-normal">
              {amenityLabels[key as AmenityKey]}
            </Badge>
          ))}
        </div>
      </header>
      {isDesk && data.desk ? (
        <DeskPicker
          key={`${data.space.id}:${data.date}`}
          data={data}
          desk={data.desk}
        />
      ) : (
        <BookingForm key={`${data.space.id}:${data.date}`} data={data} />
      )}
    </section>
  );
}
