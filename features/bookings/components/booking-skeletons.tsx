import { SkeletonRegion } from "@/components/skeleton-region";
import { SkeletonHeading, SkeletonRows } from "@/components/skeleton-shapes";
import { Skeleton } from "@/components/ui/skeleton";
import { FloorTimetableShape } from "./floor-loading-shapes";

function FloorNavigationShape() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-4 lg:grid-cols-[auto_minmax(0,1fr)_auto_auto]">
      <div className="col-span-2 row-start-1 flex min-w-0 items-center gap-3">
        <div className="flex h-11 shrink-0 items-center gap-3 rounded-lg border border-border px-4">
          <Skeleton data-slot="skeleton-photo" className="h-6 w-8" />
          <Skeleton className="h-5 w-20" />
        </div>
        <div className="flex min-w-0 gap-2 overflow-hidden">
          <Skeleton className="h-11 w-16" />
          <Skeleton className="h-11 w-16" />
        </div>
      </div>
      <div
        data-slot="skeleton-operating-status"
        className="col-start-1 row-start-3 flex min-w-0 items-center gap-2 lg:col-start-3 lg:row-start-1"
      >
        <Skeleton className="size-2 shrink-0 rounded-full" />
        <Skeleton className="h-4 w-36 max-w-full" />
      </div>
      <div
        data-slot="skeleton-view-control"
        className="col-start-2 row-start-3 flex gap-1 justify-self-end rounded-lg bg-muted p-1 lg:col-start-4 lg:row-start-1"
      >
        <Skeleton className="h-11 w-11 lg:w-20" />
        <Skeleton className="h-11 w-11 lg:w-20" />
      </div>
      <div className="col-span-2 row-start-2 flex min-w-0 items-center gap-3 lg:col-span-4">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden lg:flex-none">
          <Skeleton className="size-11 shrink-0" />
          <div data-slot="skeleton-date-window" className="flex gap-2">
            {Array.from({ length: 7 }, (_, index) => (
              <Skeleton key={index} className="h-16 w-11 shrink-0" />
            ))}
          </div>
          <Skeleton className="size-11 shrink-0" />
        </div>
        <Skeleton
          data-slot="skeleton-calendar-trigger"
          className="h-11 w-20 shrink-0"
        />
        <div className="ml-auto hidden items-center gap-4 lg:flex">
          {[0, 1, 2, 3].map((key) => (
            <Skeleton key={key} className="h-4 w-14" />
          ))}
        </div>
      </div>
    </div>
  );
}

export function FloorSpaceListShape() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-6 w-32" />
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {[0, 1, 2, 3].map((key) => (
          <div
            key={key}
            data-slot="skeleton-row"
            className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-x-3 gap-y-2 px-4 py-4 md:grid-cols-[72px_minmax(0,1fr)_minmax(12rem,0.8fr)] md:gap-x-4 md:px-5"
          >
            <Skeleton
              data-slot="skeleton-photo"
              className="col-start-1 row-start-1 row-end-4 h-11 w-14 self-start rounded-lg md:row-end-3 md:h-[54px] md:w-[72px]"
            />
            <Skeleton className="col-start-2 row-start-1 h-5 w-32 max-w-full" />
            <Skeleton className="col-start-2 row-start-3 h-4 w-48 max-w-full md:row-start-2" />
            <div
              data-slot="skeleton-status-line"
              className="col-start-2 row-start-2 flex min-w-0 items-center gap-2 md:col-start-3 md:row-start-1"
            >
              <Skeleton className="size-2 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-32 max-w-full" />
            </div>
            <div className="col-span-2 col-start-1 row-start-4 space-y-2 md:col-span-1 md:col-start-3 md:row-start-2">
              <Skeleton
                data-slot="skeleton-availability"
                className="h-3 w-full rounded-full"
              />
              <div className="flex justify-between">
                <Skeleton className="h-3 w-5" />
                <Skeleton className="h-3 w-5" />
                <Skeleton className="h-3 w-5" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FloorNavigationSkeleton() {
  return (
    <SkeletonRegion>
      <FloorNavigationShape />
    </SkeletonRegion>
  );
}

export function FloorSpaceListSkeleton() {
  return (
    <SkeletonRegion>
      <FloorSpaceListShape />
    </SkeletonRegion>
  );
}

export function FloorPageSkeleton() {
  return (
    <SkeletonRegion width="wide" className="space-y-6">
      <FloorNavigationShape />
      <div data-slot="skeleton-floor-default-list" className="lg:hidden">
        <FloorSpaceListShape />
      </div>
      <div
        data-slot="skeleton-floor-default-timetable"
        className="hidden lg:block"
      >
        <FloorTimetableShape />
      </div>
    </SkeletonRegion>
  );
}

export function SpaceDetailSkeleton() {
  return (
    <SkeletonRegion className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <Skeleton
        data-slot="skeleton-photo"
        className="h-[160px] shrink-0 rounded-none [@media(max-height:759px)]:h-[120px]"
      />
      <div
        data-slot="skeleton-detail-information"
        className="shrink-0 space-y-2 border-b border-border p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-6 w-28 rounded-full" />
        </div>
        <div className="flex gap-2">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-6 w-16 rounded-full" />
          ))}
        </div>
      </div>
      <div
        data-slot="skeleton-detail-schedule"
        className="min-h-[280px] flex-1 overflow-hidden p-4"
      >
        <Skeleton className="mb-3 h-5 w-40" />
        <div className="divide-y divide-border rounded-lg border border-border">
          {Array.from({ length: 12 }, (_, key) => (
            <div
              key={key}
              data-slot="skeleton-time-slot"
              className="grid h-11 grid-cols-[3rem_1fr] items-center gap-3 px-2 lg:h-7"
            >
              <Skeleton className="h-3 w-9" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      </div>
      <div
        data-slot="skeleton-detail-booking"
        className="shrink-0 space-y-2 border-t border-border p-4"
      >
        <Skeleton className="h-5 w-36" />
        <Skeleton className="h-4 w-48 max-w-full" />
      </div>
    </SkeletonRegion>
  );
}

export function BranchListSkeleton() {
  return (
    <SkeletonRegion width="branches" className="space-y-6">
      <SkeletonHeading />
      <div className="grid gap-5 lg:grid-cols-2">
        {[0, 1].map((key) => (
          <div
            key={key}
            data-slot="skeleton-branch-card"
            className="flex flex-col gap-5 overflow-hidden rounded-xl border border-border bg-card shadow-card"
          >
            <div className="relative aspect-[16/6]">
              <Skeleton
                data-slot="skeleton-photo"
                className="absolute inset-0 rounded-none"
              />
              <div className="absolute inset-x-3 top-3 flex justify-between gap-2">
                <Skeleton className="h-8 w-40 rounded-full" />
                <Skeleton className="h-8 w-24 rounded-full" />
              </div>
            </div>
            <div className="space-y-5 px-5">
              <div className="space-y-2">
                <Skeleton className="h-7 w-32" />
                <Skeleton className="h-5 w-64 max-w-full" />
              </div>
              <div
                data-slot="skeleton-branch-counts"
                className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border"
              >
                {[0, 1, 2].map((column) => (
                  <div key={column} className="min-w-0 space-y-1 px-3 py-3">
                    <Skeleton className="h-7 w-12 max-w-full" />
                    <Skeleton className="h-4 w-24 max-w-full" />
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-16" />
                <div
                  data-slot="skeleton-branch-hours"
                  className="grid grid-cols-7 gap-1"
                >
                  {Array.from({ length: 7 }, (_, day) => (
                    <div
                      key={day}
                      className="min-w-0 space-y-1 rounded-lg bg-muted px-1 py-2"
                    >
                      <Skeleton className="mx-auto h-4 w-4" />
                      <Skeleton className="mx-auto h-4 w-8 max-w-full" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="mt-auto flex min-h-[76px] flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/50 px-5 py-3">
              <Skeleton className="h-11 w-40" />
              <Skeleton className="h-5 w-24" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function BranchFloorsSkeleton() {
  return (
    <SkeletonRegion width="standard" className="space-y-6">
      <SkeletonHeading />
      <SkeletonRows count={2} />
    </SkeletonRegion>
  );
}

export function MyBookingsSkeleton() {
  return (
    <SkeletonRegion width="standard" className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="h-11 w-28" />
      </div>
      <div data-slot="skeleton-booking-tabs" className="flex gap-2">
        <Skeleton className="h-11 w-28" />
        <Skeleton className="h-11 w-28" />
      </div>
      <Skeleton className="h-5 w-36" />
      <SkeletonRows count={3} action photo />
    </SkeletonRegion>
  );
}
