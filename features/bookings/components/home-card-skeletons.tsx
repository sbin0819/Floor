import { SkeletonRegion } from "@/components/skeleton-region";
import { Skeleton } from "@/components/ui/skeleton";
import { HomeCard, HomeCardLink } from "./home-frame";

const card = "rounded-xl border border-border bg-card p-5 shadow-card";
export function HomeNextBookingShape() {
  return (
    <div data-slot="home-next-shape" className={card}>
      <h2 className="mb-5 font-semibold">다음 예약</h2>
      <div className="flex flex-col gap-5 md:flex-row md:items-center">
        <Skeleton
          data-slot="skeleton-photo"
          className="h-[150px] w-full shrink-0 rounded-lg md:w-[232px]"
        />
        <div className="min-w-0 flex-1 space-y-4">
          <Skeleton className="h-4 w-36 max-w-full" />
          <Skeleton className="h-8 w-48 max-w-full" />
          <Skeleton className="h-4 w-56 max-w-full" />
          <div className="flex gap-2">
            <Skeleton className="h-11 w-24" />
            <Skeleton className="h-11 w-24" />
          </div>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap justify-between gap-3 border-t border-border pt-4">
        <Skeleton className="h-4 w-64 max-w-full" />
        <HomeCardLink href="/bookings">내 예약 모두 보기</HomeCardLink>
      </div>
    </div>
  );
}
export function HomeWeekBookingsShape() {
  return (
    <div data-slot="home-week-shape">
      <HomeCard
        title="이번 주 내 예약"
        action={
          <HomeCardLink href="/bookings?view=calendar">
            달력으로 보기
          </HomeCardLink>
        }
      >
        <div className="space-y-1">
          {Array.from({ length: 7 }, (_, i) => (
            <div
              key={i}
              data-slot="skeleton-week-day"
              className="flex min-h-11 items-center gap-3"
            >
              <Skeleton className="h-4 w-16" />
              <Skeleton className="h-6 min-w-0 flex-1" />
            </div>
          ))}
        </div>
      </HomeCard>
    </div>
  );
}
export function HomeFrequentSpacesShape() {
  return (
    <div data-slot="home-frequent-shape">
      <HomeCard
        title="자주 쓰는 공간"
        action={
          <span className="text-xs text-muted-foreground">최근 30일</span>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {Array.from({ length: 3 }, (_, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-lg border border-border"
            >
              <Skeleton
                data-slot="skeleton-photo"
                className="aspect-[4/3] w-full rounded-none"
              />
              <div className="space-y-2 p-3">
                <Skeleton className="h-4 w-24 max-w-full" />
                <Skeleton className="h-3 w-32 max-w-full" />
              </div>
            </div>
          ))}
        </div>
      </HomeCard>
    </div>
  );
}
export function HomeFreeSpacesShape() {
  return (
    <div data-slot="home-free-shape">
      <HomeCard
        title="지금 비어 있는 공간"
        action={<HomeCardLink href="/branches">지점 바꾸기</HomeCardLink>}
      >
        <div className="divide-y divide-border">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex gap-3 py-4">
              <Skeleton
                data-slot="skeleton-photo"
                className="h-11 w-[60px] shrink-0"
              />
              <div className="min-w-0 flex-1 space-y-3">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-48 max-w-full" />
                <Skeleton className="h-2 w-full" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
        <Skeleton className="h-4 w-56 max-w-full" />
      </HomeCard>
    </div>
  );
}
export function HomeNextBookingSkeleton() {
  return (
    <SkeletonRegion>
      <HomeNextBookingShape />
    </SkeletonRegion>
  );
}
export function HomeWeekBookingsSkeleton() {
  return (
    <SkeletonRegion>
      <HomeWeekBookingsShape />
    </SkeletonRegion>
  );
}
export function HomeFrequentSpacesSkeleton() {
  return (
    <SkeletonRegion>
      <HomeFrequentSpacesShape />
    </SkeletonRegion>
  );
}
export function HomeFreeSpacesSkeleton() {
  return (
    <SkeletonRegion>
      <HomeFreeSpacesShape />
    </SkeletonRegion>
  );
}
