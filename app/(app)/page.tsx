import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import Link from "next/link";
import { PageContainer } from "@/components/page-container";
import { getHomeTeams } from "@/features/teams/queries";
import { getAccountMenuData } from "@/features/auth/queries";
import {
  getHomeHeader,
  getHomeUpcomingBookings,
  getHomeFreeSpaces,
  getHomeBookingLimits,
  getHomeWeekBookings,
  getHomeFrequentSpaces,
} from "@/features/bookings/queries";
import {
  HomeHeader,
  HomeUpcomingBookings,
  HomeFreeSpaces,
  HomeBookingLimits,
  HomeTeams,
} from "@/features/bookings/components/home-dashboard";
import {
  HomeWeekBookings,
  HomeFrequentSpaces,
} from "@/features/bookings/components/home-secondary-cards";
import {
  HomeDashboardSkeleton,
  HomeHeaderSkeleton,
  HomeCardSkeleton,
} from "@/features/bookings/components/home-skeletons";
import { SkeletonRegion } from "@/components/skeleton-region";
import { Skeleton } from "@/components/ui/skeleton";

async function Header() {
  return <HomeHeader data={await getHomeHeader()} />;
}
async function Upcoming() {
  return <HomeUpcomingBookings data={await getHomeUpcomingBookings()} />;
}
async function FreeSpaces() {
  return <HomeFreeSpaces data={await getHomeFreeSpaces()} />;
}
async function Limits() {
  return <HomeBookingLimits data={await getHomeBookingLimits()} />;
}
async function WeekBookings() {
  return <HomeWeekBookings data={await getHomeWeekBookings()} />;
}
async function FrequentSpaces() {
  return <HomeFrequentSpaces data={await getHomeFrequentSpaces()} />;
}
async function Teams() {
  return <HomeTeams data={await getHomeTeams()} />;
}
async function OperatorLink() {
  const data = await getAccountMenuData();
  return data.isOperator ? (
    <Link
      href="/admin"
      className="inline-flex min-h-11 items-center rounded-lg text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
    >
      운영자 화면
    </Link>
  ) : null;
}

async function HomeContent() {
  await requirePageSession("/");
  return (
    <PageContainer as="main" width="wide" className="space-y-6">
      <Suspense fallback={<HomeHeaderSkeleton />}>
        <Header />
      </Suspense>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <Suspense fallback={<HomeCardSkeleton photo />}>
            <Upcoming />
          </Suspense>
          <Suspense fallback={<HomeCardSkeleton rows={4} photo />}>
            <FreeSpaces />
          </Suspense>
          <Suspense fallback={<HomeCardSkeleton rows={3} photo />}>
            <FrequentSpaces />
          </Suspense>
        </div>
        <div className="space-y-6">
          <Suspense fallback={<HomeCardSkeleton rows={7} />}>
            <WeekBookings />
          </Suspense>
          <Suspense fallback={<HomeCardSkeleton rows={1} />}>
            <Limits />
          </Suspense>
          <Suspense fallback={<HomeCardSkeleton rows={2} />}>
            <Teams />
          </Suspense>
          <Suspense
            fallback={
              <SkeletonRegion>
                <Skeleton className="h-11 w-32" />
              </SkeletonRegion>
            }
          >
            <OperatorLink />
          </Suspense>
        </div>
      </div>
    </PageContainer>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<HomeDashboardSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}
