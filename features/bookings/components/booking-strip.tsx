"use client";

import { useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { PhotoViewer } from "@/components/photos/photo-viewer";
import { SpacePhoto } from "@/components/photos/space-photo";
import { Button } from "@/components/ui/button";
import {
  floorHref,
  formatBookingDate,
  formatBookingTime,
} from "@/features/bookings/format";
import { useFloorSelection } from "./branch-workspace";
import { useBookingAttendeeCount, useBookingRange } from "./use-booking-draft";
import { FloorNavigationLink } from "./floor-navigation-link";
import { useFloorPeople } from "./floor-view";
import { effectiveAttendeeCount } from "../attendee-count";

export function BookingStrip({ children }: { children: ReactNode }) {
  const workspace = useFloorSelection();
  const { people } = useFloorPeople();
  const sharedRange = useBookingRange(
    workspace?.draftStore,
    workspace?.bookingScope,
  );
  const countDraft = useBookingAttendeeCount(
    workspace?.draftStore,
    workspace?.bookingScope,
  );
  const [photoOpen, setPhotoOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const data = workspace?.floorData;
  const selected = workspace?.location.spaceId;
  const space = data?.spaces.find(
    (space) => space.kind === "accessible" && space.id === selected,
  );
  if (
    !workspace ||
    workspace.detailCleared ||
    !selected ||
    !data ||
    !space ||
    space.kind !== "accessible"
  )
    return null;
  const attendeeCount =
    space.bookable && space.capacity !== 1
      ? effectiveAttendeeCount(countDraft, people, space.capacity)
      : null;
  const range = sharedRange?.spaceId === space.id ? sharedRange : null;
  const duration = range
    ? (Date.parse(range.end) - Date.parse(range.start)) / 60_000
    : 0;
  return (
    <section
      role="region"
      aria-label="예약"
      data-space-detail-layout="strip"
      className="sticky bottom-4 z-40 grid min-w-0 grid-cols-[minmax(13rem,1fr)_minmax(0,2fr)_44px] items-center gap-4 rounded-xl border border-border bg-card p-4 shadow-pop"
    >
      <div className="order-2 min-w-0">{children}</div>
      <div
        className="order-1 flex min-w-0 items-center gap-3"
        aria-live="polite"
        aria-atomic="true"
      >
        <button
          ref={trigger}
          type="button"
          aria-label={`${space.name} 사진 크게 보기`}
          className="shrink-0 rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
          onClick={() => setPhotoOpen(true)}
        >
          <SpacePhoto photo={space.photo} type={space.type} decorative />
        </button>
        <div className="min-w-0 space-y-1">
          <h2 className="truncate font-bold">{space.name}</h2>
          <p className="text-xs text-muted-foreground tabular-nums">
            {data.floor.level}F
            {space.capacity !== null && ` · 최대 ${space.capacity}인`}
          </p>
          <p className="text-xs tabular-nums">
            {range ? (
              <>
                {formatBookingDate(data.date, data.branch.timezone)} ·{" "}
                {formatBookingTime(
                  range.start,
                  range.end,
                  data.branch.timezone,
                )}{" "}
                · {duration >= 60 ? `${Math.floor(duration / 60)}시간` : ""}
                {duration % 60 ? `${duration % 60}분` : ""}
                {attendeeCount !== null && ` · ${attendeeCount}명`}
              </>
            ) : (
              "시간을 골라 주세요"
            )}
          </p>
        </div>
      </div>
      <Button
        asChild
        variant="ghost"
        size="icon"
        className="order-3 self-start"
      >
        <FloorNavigationLink
          href={floorHref(
            workspace.branchId,
            workspace.location.floorId,
            workspace.location.date,
            undefined,
            workspace.search.get("view") ?? undefined,
          )}
          location={{ ...workspace.location, spaceId: null }}
          replace
          aria-label="공간 상세 닫기"
        >
          <X aria-hidden="true" />
        </FloorNavigationLink>
      </Button>
      <PhotoViewer
        photos={space.photo ? [space.photo] : []}
        name={space.name}
        type={space.type}
        open={photoOpen}
        onOpenChange={setPhotoOpen}
        triggerRef={trigger}
      />
    </section>
  );
}
