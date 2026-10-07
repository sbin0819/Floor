"use client";

import type { ReactNode } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { floorHref } from "@/features/bookings/format";
import { useFloorSelection } from "./branch-workspace";
import { useWideScreen, type MatchMedia } from "./use-wide-screen";
import { useFloorView } from "./floor-view";
import { BookingStrip } from "./booking-strip";

export function SpaceDetailContainer({
  children,
  matchMedia,
  closed = false,
}: {
  children: ReactNode;
  matchMedia?: MatchMedia;
  closed?: boolean;
}) {
  const wide = useWideScreen(matchMedia);
  const navigation = useFloorSelection();
  const params = useParams<{ branchId: string }>();
  const search = useSearchParams();
  const { effectiveView } = useFloorView();
  if (closed || navigation?.floorData?.openHours === null) return null;
  if (wide && effectiveView === "timeline")
    return <BookingStrip>{children}</BookingStrip>;
  if (wide)
    return (
      <div
        data-space-detail-layout="panel"
        className="hidden min-h-0 w-full lg:sticky lg:top-6 lg:block lg:h-[calc(100dvh-15rem)] lg:min-h-[32rem] lg:w-[420px]"
      >
        {children}
      </div>
    );
  const open =
    navigation !== null &&
    !navigation.detailCleared &&
    navigation.location.spaceId !== null;
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next || !navigation) return;
        const location = { ...navigation.location, spaceId: null };
        navigation.change(
          location,
          floorHref(
            params.branchId,
            location.floorId,
            location.date,
            undefined,
            search.get("view") ?? undefined,
          ),
          { replace: true },
        );
      }}
    >
      <SheetContent
        side="bottom"
        showCloseButton={navigation?.detailPending ?? false}
        aria-describedby={undefined}
        className="max-h-[85dvh] gap-0 overflow-hidden rounded-t-xl data-[side=bottom]:h-[85dvh]"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          navigation?.restoreSpaceTrigger();
        }}
      >
        <SheetTitle className="sr-only">공간 상세</SheetTitle>
        <div
          data-space-detail-layout="sheet"
          className="flex h-full min-h-0 flex-col overflow-hidden"
        >
          {children}
        </div>
      </SheetContent>
    </Sheet>
  );
}
