import { SkeletonRegion } from "@/components/skeleton-region";
import {
  SkeletonFields,
  SkeletonHeading,
  SkeletonRows,
} from "@/components/skeleton-shapes";
import { Skeleton } from "@/components/ui/skeleton";

export function AdminNavSkeleton() {
  return (
    <SkeletonRegion className="space-y-2">
      <Skeleton className="h-11 w-full bg-sidebar-accent" />
      <Skeleton className="h-11 w-full bg-sidebar-accent" />
    </SkeletonRegion>
  );
}

export function AdminHomeSkeleton() {
  return (
    <SkeletonRegion className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <SkeletonHeading />
      <SkeletonRows count={2} />
    </SkeletonRegion>
  );
}

export function AdminBranchSkeleton() {
  return (
    <SkeletonRegion className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
      <Skeleton className="h-11 w-24" />
      <Skeleton className="h-8 w-40" />
      <div className="space-y-5 rounded-xl border bg-card p-5">
        <Skeleton className="h-7 w-28" />
        <SkeletonFields count={2} />
        <Skeleton className="h-4 w-72 max-w-full" />
        <div className="space-y-3">
          {Array.from({ length: 7 }, (_, index) => (
            <div
              key={index}
              data-slot="skeleton-hours-row"
              className="flex flex-wrap items-center gap-3"
            >
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-11 w-28" />
              <Skeleton className="h-11 w-28" />
              <Skeleton className="h-6 w-12 rounded-full" />
            </div>
          ))}
        </div>
        <Skeleton className="h-11 w-36" />
      </div>
      <div className="space-y-4 rounded-xl border bg-card p-5">
        <Skeleton className="h-7 w-16" />
        <SkeletonRows count={2} />
      </div>
    </SkeletonRegion>
  );
}

export function AdminFloorSkeleton() {
  return (
    <SkeletonRegion className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <Skeleton className="h-11 w-24" />
      <Skeleton className="h-8 w-40" />
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4 rounded-xl border bg-card p-5">
          <Skeleton className="h-7 w-28" />
          <SkeletonFields count={3} />
          <Skeleton className="h-11 w-28" />
        </div>
        <div className="space-y-4 rounded-xl border bg-card p-5">
          <SkeletonHeading compact />
          <SkeletonFields count={2} />
          <Skeleton className="h-11 w-28" />
        </div>
      </div>
      <div className="space-y-4 rounded-xl border bg-card p-5">
        <Skeleton className="h-7 w-28" />
        <SkeletonRows count={3} action />
      </div>
    </SkeletonRegion>
  );
}
