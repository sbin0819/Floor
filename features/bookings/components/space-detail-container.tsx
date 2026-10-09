"use client";

import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { floorHref } from "@/features/bookings/format";
import { useFloorSelection } from "./branch-workspace";
import { useWideScreen, type MatchMedia } from "./use-wide-screen";
import { useFloorView } from "./floor-view";
import { BookingStrip } from "./booking-strip";
import { spaceDetailMode } from "../space-detail-mode";

export function SpaceDetailContainer({
  children,
  resolution,
  matchMedia,
  closed = false,
}: {
  children: ReactNode;
  resolution?: ReactNode;
  matchMedia?: MatchMedia;
  closed?: boolean;
}) {
  const wide = useWideScreen(matchMedia);
  const navigation = useFloorSelection();
  const { effectiveView } = useFloorView();
  const space = navigation?.floorData?.spaces.find(
    (space) =>
      space.kind === "accessible" && space.id === navigation.location.spaceId,
  );
  const { mode, keepSpaceOnClose } = spaceDetailMode({
    wide,
    view: effectiveView,
    detail: navigation?.location.detail === true,
    space: space?.kind === "accessible" ? space : null,
  });
  const rightDetail = mode === "detail";
  const mobilePlan = !wide && effectiveView === "plan";
  const summary =
    mobilePlan &&
    !navigation?.location.detail &&
    !(space?.kind === "accessible" && space.deskCount > 0);
  if (closed || navigation?.floorData?.openHours === null)
    return resolution ?? null;
  if (mode === "strip")
    return (
      <>
        {resolution}
        <BookingStrip>{children}</BookingStrip>
      </>
    );
  if (mode === "panel")
    return (
      <>
        {resolution}
        <div
          data-space-detail-layout="panel"
          className="hidden min-h-0 w-full lg:sticky lg:top-20 lg:block lg:h-[calc(100dvh-15rem)] lg:min-h-[32rem] lg:w-[420px]"
        >
          {children}
        </div>
      </>
    );
  const open =
    navigation !== null &&
    !navigation.detailCleared &&
    navigation.location.spaceId !== null;
  const title =
    rightDetail && space?.kind === "accessible"
      ? `${space.name} 상세`
      : "공간 상세";
  return (
    <>
      {resolution}
      <Sheet
        modal={!mobilePlan}
        open={open}
        onOpenChange={(next) => {
          if (next || !navigation) return;
          const location = keepSpaceOnClose
            ? { ...navigation.location, detail: false }
            : { ...navigation.location, spaceId: null, detail: false };
          navigation.change(
            location,
            floorHref(
              navigation.branchId,
              location.floorId,
              location.date,
              location.spaceId ?? undefined,
              navigation.search.get("view") ?? undefined,
            ),
            { replace: true },
          );
          if (rightDetail) navigation.restoreSpaceTrigger();
        }}
      >
        <SheetContent
          side={rightDetail ? "right" : "bottom"}
          showCloseButton={navigation?.detailPending ?? false}
          aria-describedby={undefined}
          className={
            rightDetail
              ? "gap-0 overflow-hidden data-[side=right]:w-[420px] data-[side=right]:sm:max-w-none"
              : summary
                ? "max-h-[50dvh] gap-0 overflow-hidden rounded-t-xl data-[side=bottom]:h-auto"
                : "max-h-[85dvh] gap-0 overflow-hidden rounded-t-xl data-[side=bottom]:h-[85dvh]"
          }
          onInteractOutside={(event) => {
            // 평면도를 움직이거나 다른 공간을 골라도 같은 시트가 유지된다.
            if (mobilePlan) event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            navigation?.restoreSpaceTrigger();
          }}
        >
          <SheetTitle className="sr-only">{title}</SheetTitle>
          <div
            data-space-detail-layout={rightDetail ? "detail" : "sheet"}
            className="flex h-full min-h-0 flex-col overflow-hidden"
          >
            {children}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
