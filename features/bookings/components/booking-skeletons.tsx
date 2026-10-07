import { SkeletonRegion } from "@/components/skeleton-region";
import {
  SkeletonFields,
  SkeletonHeading,
  SkeletonRows,
} from "@/components/skeleton-shapes";
import { Skeleton } from "@/components/ui/skeleton";

function FloorNavigationShape() {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-4">
        <Skeleton className="h-11 w-32" />
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex gap-2">
          <Skeleton className="h-11 w-16" />
          <Skeleton className="h-11 w-16" />
        </div>
        <div
          data-slot="skeleton-date-window"
          className="flex min-w-0 gap-2 overflow-hidden"
        >
          {Array.from({ length: 7 }, (_, index) => (
            <Skeleton key={index} className="h-14 min-w-11" />
          ))}
        </div>
      </div>
    </div>
  );
}

function FloorSpaceListShape() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-6 w-32" />
      <div className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
        {[0, 1, 2, 3].map((key) => (
          <div
            key={key}
            data-slot="skeleton-row"
            className="grid gap-3 p-5 sm:grid-cols-[minmax(0,1fr)_minmax(12rem,0.8fr)] sm:items-center sm:gap-5"
          >
            <div className="space-y-2">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-48 max-w-full" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between gap-4">
                <Skeleton className="h-6 w-20 rounded-full" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton
                data-slot="skeleton-availability"
                className="h-2 w-full rounded-full"
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
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)]">
        <FloorSpaceListShape />
        <div className="flex min-h-40 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border p-8">
          <Skeleton className="size-11" />
          <Skeleton className="h-5 w-48 max-w-full" />
        </div>
      </div>
    </SkeletonRegion>
  );
}

export function SpaceDetailSkeleton() {
  return (
    <SkeletonRegion className="space-y-6 rounded-xl border border-border bg-card p-5">
      <SkeletonHeading />
      <div className="flex gap-2">
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-6 w-20 rounded-full" />
        ))}
      </div>
      <SkeletonFields count={3} />
      <div className="space-y-2">
        {[0, 1, 2, 3, 4, 5].map((key) => (
          <Skeleton key={key} className="h-11 w-full" />
        ))}
      </div>
      <Skeleton className="h-11 w-full" />
    </SkeletonRegion>
  );
}

export function BranchListSkeleton() {
  return (
    <SkeletonRegion width="standard" className="space-y-6">
      <SkeletonHeading />
      <div className="grid gap-4 sm:grid-cols-2">
        {[0, 1].map((key) => (
          <div key={key} className="space-y-5 rounded-xl border bg-card p-5">
            <SkeletonHeading compact />
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-11 w-28" />
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
    <SkeletonRegion width="standard" className="space-y-8">
      <Skeleton className="h-8 w-36" />
      {[0, 1].map((key) => (
        <div key={key} className="space-y-4">
          <Skeleton className="h-7 w-40" />
          <SkeletonRows count={2} action={key === 0} />
        </div>
      ))}
    </SkeletonRegion>
  );
}
