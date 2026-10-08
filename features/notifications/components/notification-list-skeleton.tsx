import { SkeletonRegion } from "@/components/skeleton-region";
import { Skeleton } from "@/components/ui/skeleton";

export function NotificationListSkeleton() {
  return (
    <SkeletonRegion className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          data-slot="notification-skeleton-row"
          className="flex min-h-24 items-start gap-3 px-4 py-4"
        >
          <div aria-hidden="true" className="w-2 shrink-0" />
          <Skeleton className="size-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-3 py-1">
            <Skeleton className="h-4 w-4/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        </div>
      ))}
    </SkeletonRegion>
  );
}
