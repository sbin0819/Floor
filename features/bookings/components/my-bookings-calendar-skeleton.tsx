import { PageContainer, PageHeading } from "@/components/page-container";
import { SkeletonRegion } from "@/components/skeleton-region";
import { Skeleton } from "@/components/ui/skeleton";
import { buildMonthGrid, parseCalendarMonth } from "@/lib/calendar/month";

export function MyBookingsCalendarBodySkeleton({
  month,
}: { month?: string } = {}) {
  const parsed = month ? parseCalendarMonth(month) : null;
  const cells = parsed
    ? buildMonthGrid(parsed.year, parsed.month).weeks.length * 7
    : 35;
  return (
    <SkeletonRegion className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-card">
        <div
          data-slot="skeleton-calendar-weekdays"
          className="grid grid-cols-7"
        >
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index} className="flex h-8 items-center justify-center">
              <Skeleton className="h-3 w-4" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-px bg-border">
          {Array.from({ length: cells }, (_, index) => (
            <div
              key={index}
              data-slot="skeleton-calendar-day"
              className="flex h-11 flex-col items-center bg-card px-2 py-1 md:block md:h-28 md:space-y-3 md:p-2"
            >
              <Skeleton className="size-7 shrink-0 rounded-full" />
              <div className="mt-1 flex h-1 gap-1 md:hidden">
                {index % 3 === 0 && (
                  <Skeleton className="size-1 rounded-full" />
                )}
              </div>
              {index % 3 === 0 && (
                <Skeleton className="hidden h-5 w-full md:block" />
              )}
            </div>
          ))}
        </div>
      </div>
      <div
        data-slot="skeleton-calendar-panel"
        className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-card"
      >
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-7 w-48" />
        <div className="space-y-3 rounded-lg border border-border p-3">
          <div className="flex gap-3">
            <Skeleton className="h-12 w-16" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-20" />
            </div>
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
          <div className="flex gap-2">
            <Skeleton className="h-11 w-24" />
            <Skeleton className="h-11 w-24" />
          </div>
        </div>
        <Skeleton className="h-11 w-full" />
      </div>
    </SkeletonRegion>
  );
}

export function MyBookingsCalendarSkeleton() {
  return (
    <PageContainer as="main" width="wide" className="space-y-6">
      <div className="space-y-1">
        <PageHeading
          title="내 예약"
          action={<Skeleton className="h-11 w-28" />}
        />
        <Skeleton className="h-5 w-32" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-12 w-40" />
        <div className="flex gap-2">
          <Skeleton className="h-11 w-16" />
          <Skeleton className="h-11 w-11" />
          <Skeleton className="h-11 w-36" />
          <Skeleton className="h-11 w-11" />
        </div>
      </div>
      <MyBookingsCalendarBodySkeleton />
    </PageContainer>
  );
}
