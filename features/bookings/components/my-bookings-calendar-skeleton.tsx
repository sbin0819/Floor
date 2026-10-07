import { PageContainer, PageHeading } from "@/components/page-container";
import { SkeletonRegion } from "@/components/skeleton-region";
import { Skeleton } from "@/components/ui/skeleton";

export function MyBookingsCalendarBodySkeleton() {
  return (
    <SkeletonRegion className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="grid grid-cols-7 gap-px overflow-hidden rounded-xl border border-border bg-border">
        {Array.from({ length: 35 }, (_, index) => (
          <div key={index} className="min-h-28 space-y-3 bg-card p-2">
            <Skeleton className="size-6 rounded-full" />
            {index % 3 === 0 && <Skeleton className="h-5 w-full" />}
          </div>
        ))}
      </div>
      <div className="space-y-4 rounded-xl border border-border bg-card p-5">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-44 w-full rounded-lg" />
        <Skeleton className="h-11 w-full" />
      </div>
    </SkeletonRegion>
  );
}

export function MyBookingsCalendarSkeleton() {
  return (
    <PageContainer as="main" width="wide" className="space-y-6">
      <PageHeading title="내 예약" />
      <Skeleton className="h-12 w-40" />
      <Skeleton className="h-11 w-72" />
      <MyBookingsCalendarBodySkeleton />
    </PageContainer>
  );
}
