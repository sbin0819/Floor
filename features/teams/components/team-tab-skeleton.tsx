import { SkeletonRegion } from "@/components/skeleton-region";
import { Skeleton } from "@/components/ui/skeleton";
import type { TeamTab } from "../navigation";

export function TeamTabSkeleton({ tab = "members" }: { tab?: TeamTab }) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold">
        {
          {
            members: "팀원 목록",
            requests: "요청·초대",
            bookings: "팀 예약",
            settings: "팀 정보",
          }[tab]
        }
      </h2>
      <SkeletonRegion className="space-y-4 rounded-xl border bg-card p-5">
        {[0, 1, 2].map((row) => (
          <div key={row} className="flex min-h-16 items-center gap-4">
            <Skeleton className="size-9 shrink-0 rounded-full" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-48 max-w-full" />
            </div>
          </div>
        ))}
      </SkeletonRegion>
    </section>
  );
}
