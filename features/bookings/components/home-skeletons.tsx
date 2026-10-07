import { SkeletonRegion } from "@/components/skeleton-region";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonHeading, SkeletonRows } from "@/components/skeleton-shapes";

export function HomeHeaderSkeleton() {
  return (
    <SkeletonRegion className="flex items-center justify-between gap-4">
      <SkeletonHeading />
      <Skeleton className="h-11 w-36" />
    </SkeletonRegion>
  );
}
export function HomeCardSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <SkeletonRegion className="space-y-5 rounded-xl border border-border bg-card p-5">
      <Skeleton className="h-6 w-40" />
      <SkeletonRows count={rows} />
    </SkeletonRegion>
  );
}
export function HomeDashboardSkeleton() {
  return (
    <SkeletonRegion width="wide" className="space-y-6">
      <SkeletonHeading />
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <HomeCardShape rows={3} />
          <HomeCardShape rows={4} />
        </div>
        <div className="space-y-6">
          <HomeCardShape rows={1} />
          <HomeCardShape rows={2} />
        </div>
      </div>
    </SkeletonRegion>
  );
}
function HomeCardShape({ rows }: { rows: number }) {
  return (
    <div
      aria-hidden="true"
      className="space-y-5 rounded-xl border border-border bg-card p-5"
    >
      <Skeleton className="h-6 w-40" />
      <SkeletonRows count={rows} />
    </div>
  );
}
