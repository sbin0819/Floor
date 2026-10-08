import { SkeletonRegion } from "@/components/skeleton-region";
import { SkeletonHeading, SkeletonRows } from "@/components/skeleton-shapes";
import {
  HomeCard,
  HomeCardLink,
  HomeDashboardFrame,
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
    <HomeCard
      title={title}
      action={
        title === "내 팀" ? (
          <HomeCardLink href="/teams">팀 관리</HomeCardLink>
        ) : undefined
      }
    >
      <SkeletonRegion>
        <SkeletonRows count={rows} photo={photo} />
      </SkeletonRegion>
    </HomeCard>
  );
}
export function HomeDashboardSkeleton() {
  return (
    <SkeletonRegion>
      <HomeDashboardFrame
        header={<SkeletonHeading />}
        primary={
          <>
            <HomeNextBookingShape />
            <HomeFreeSpacesShape />
            <HomeFrequentSpacesShape />
          </>
        }
        secondary={
          <>
            <HomeWeekBookingsShape />
            <HomeCard title="오늘 예약 한도">
              <SkeletonRows count={1} />
            </HomeCard>
            <HomeCard
              title="내 팀"
              action={<HomeCardLink href="/teams">팀 관리</HomeCardLink>}
            >
              <SkeletonRows count={2} />
            </HomeCard>
          </>
        }
      />
    </SkeletonRegion>
  );
}
