import { SkeletonRegion } from "@/components/skeleton-region";
import { SkeletonHeading, SkeletonRows } from "@/components/skeleton-shapes";
import {
  HomeCard,
  HomeDashboardFrame,
  HomeDashboardRows,
  HomeHeaderFrame,
} from "./home-frame";
import {
  HomeNextBookingShape,
  HomeWeekBookingsShape,
  HomeFrequentSpacesShape,
  HomeFreeSpacesShape,
} from "./home-card-skeletons";

export function HomeHeaderSkeleton() {
  return (
    <HomeHeaderFrame>
      <HomeGreetingSkeleton />
    </HomeHeaderFrame>
  );
}
export function HomeGreetingSkeleton() {
  return (
    <SkeletonRegion>
      <SkeletonHeading />
    </SkeletonRegion>
  );
}
export function HomeCardSkeleton({
  rows = 3,
  photo = false,
  title = "오늘 예약 한도",
}: {
  rows?: number;
  photo?: boolean;
  title?: string;
}) {
  return (
    <HomeCard title={title}>
      <SkeletonRegion>
        <SkeletonRows count={rows} photo={photo} />
      </SkeletonRegion>
    </HomeCard>
  );
}
export function HomeDashboardSkeleton() {
  return (
    <SkeletonRegion>
      <HomeDashboardFrame header={<SkeletonHeading />}>
        <HomeRowsShape />
      </HomeDashboardFrame>
    </SkeletonRegion>
  );
}

function HomeRowsShape() {
  return (
    <HomeDashboardRows
      firstRow={
        <>
          <HomeNextBookingShape />
          <HomeFreeSpacesShape />
        </>
      }
      week={<HomeWeekBookingsShape />}
      thirdRow={
        <>
          <HomeCard title="오늘 예약 한도">
            <SkeletonRows count={1} />
          </HomeCard>
          <HomeFrequentSpacesShape />
        </>
      }
    />
  );
}

export function HomeRowsSkeleton() {
  return (
    <SkeletonRegion className="space-y-6">
      <HomeRowsShape />
    </SkeletonRegion>
  );
}
