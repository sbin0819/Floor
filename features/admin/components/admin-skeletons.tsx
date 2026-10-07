import { SkeletonRegion } from "@/components/skeleton-region";
import { SkeletonFields, SkeletonHeading } from "@/components/skeleton-shapes";
import { Skeleton } from "@/components/ui/skeleton";

export function AdminNavSkeleton() {
  return (
    <SkeletonRegion className="space-y-2">
      <Skeleton className="h-11 w-full bg-sidebar-accent" />
      <Skeleton className="h-11 w-full bg-sidebar-accent" />
    </SkeletonRegion>
  );
}

export function AdminBreadcrumbSkeleton({ depth = 1 }: { depth?: 1 | 2 | 3 }) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton-breadcrumb"
      className="flex min-h-11 items-center gap-3"
    >
      {Array.from({ length: depth }, (_, index) => (
        <Skeleton key={index} className="h-5 w-16" />
      ))}
    </div>
  );
}

export function AdminHomeSkeleton() {
  return (
    <SkeletonRegion className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
      <AdminBreadcrumbSkeleton />
      <Skeleton className="h-8 w-40" />
      <div className="space-y-4">
        <Skeleton className="h-7 w-24" />
        <div className="grid gap-5 sm:grid-cols-2">
          {[0, 1].map((index) => (
            <div
              key={index}
              data-slot="skeleton-branch-card"
              className="space-y-5 rounded-xl border bg-card p-5"
            >
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-5 w-44 max-w-full" />
              <Skeleton className="h-5 w-32" />
              <div className="border-t pt-4">
                <Skeleton className="h-5 w-36" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}

export function AdminBranchSkeleton() {
  return (
    <SkeletonRegion className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
      <AdminBreadcrumbSkeleton depth={2} />
      <Skeleton className="h-8 w-40" />
      <div className="space-y-5 rounded-xl border bg-card p-5">
        <Skeleton className="h-7 w-28" />
        <SkeletonFields count={2} />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="space-y-5 rounded-xl border bg-card p-5">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-11 w-64 max-w-full" />
        <div className="space-y-3">
          {Array.from({ length: 7 }, (_, index) => (
            <div
              key={index}
              data-slot="skeleton-hours-row"
              className="grid grid-cols-[3rem_3rem_minmax(0,1fr)_minmax(0,1fr)] items-center gap-2"
            >
              <Skeleton className="h-5 w-12" />
              <Skeleton className="h-6 w-12 rounded-full" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-11 w-full" />
            </div>
          ))}
        </div>
      </div>
      <Skeleton className="h-11 w-36" />
      <div className="space-y-4 rounded-xl border bg-card p-5">
        <Skeleton className="h-7 w-16" />
        {[0, 1].map((index) => (
          <div
            key={index}
            data-slot="skeleton-row"
            className="grid grid-cols-4 items-center gap-3 border-t py-3"
          >
            <Skeleton className="h-11 w-12" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-full rounded-full" />
            <Skeleton className="h-5 w-12" />
          </div>
        ))}
      </div>
    </SkeletonRegion>
  );
}

export function AdminFloorSkeleton() {
  return (
    <SkeletonRegion className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <AdminBreadcrumbSkeleton depth={3} />
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
        <Skeleton className="h-5 w-24" />
        <div className="overflow-hidden rounded-lg border border-border">
          {[0, 1, 2].map((row) => (
            <div
              key={row}
              data-slot="skeleton-row"
              className="grid min-w-[560px] grid-cols-[2fr_1fr_1fr_2fr_1fr_44px] items-center gap-4 border-b p-3 last:border-b-0"
            >
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-8" />
              <Skeleton className="size-4" />
              <Skeleton className="h-5 w-full" />
              <Skeleton className="h-5 w-full rounded-full" />
              <Skeleton className="size-11" />
            </div>
          ))}
        </div>
      </div>
    </SkeletonRegion>
  );
}
