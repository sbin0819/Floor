import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import Link from "next/link";
import { HomeDashboardFrame } from "@/features/bookings/components/home-frame";
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
  HomeGreeting,
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
  HomeGreetingSkeleton,
  HomeCardSkeleton,
} from "@/features/bookings/components/home-skeletons";
import { SkeletonRegion } from "@/components/skeleton-region";
import { Skeleton } from "@/components/ui/skeleton";
import {
  HomeNextBookingSkeleton,
  HomeWeekBookingsSkeleton,
  HomeFrequentSpacesSkeleton,
  HomeFreeSpacesSkeleton,
} from "@/features/bookings/components/home-card-skeletons";

async function Header() {
  await requirePageSession("/");
  return <HomeGreeting data={await getHomeHeader()} />;
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

async function PrimaryCards() {
  await requirePageSession("/");
  return (
    <>
      <Suspense fallback={<HomeNextBookingSkeleton />}>
        <Upcoming />
      </Suspense>
      <Suspense fallback={<HomeFreeSpacesSkeleton />}>
        <FreeSpaces />
      </Suspense>
      <Suspense fallback={<HomeFrequentSpacesSkeleton />}>
        <FrequentSpaces />
      </Suspense>
    </>
  );
}

async function SecondaryCards() {
  await requirePageSession("/");
  return (
    <>
      <Suspense fallback={<HomeWeekBookingsSkeleton />}>
        <WeekBookings />
      </Suspense>
      <Suspense fallback={<HomeCardSkeleton rows={1} />}>
        <Limits />
      </Suspense>
      <Suspense fallback={<HomeCardSkeleton title="내 팀" rows={2} />}>
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
    </>
  );
}

export default function Home() {
  return (
    <HomeDashboardFrame
      header={
        <Suspense fallback={<HomeGreetingSkeleton />}>
          <Header />
        </Suspense>
      }
      primary={
        <Suspense
          fallback={
            <>
              <HomeNextBookingSkeleton />
              <HomeFreeSpacesSkeleton />
              <HomeFrequentSpacesSkeleton />
            </>
          }
        >
          <PrimaryCards />
        </Suspense>
      }
      secondary={
        <Suspense
          fallback={
            <>
              <HomeWeekBookingsSkeleton />
              <HomeCardSkeleton rows={1} />
              <HomeCardSkeleton title="내 팀" rows={2} />
            </>
          }
        >
          <SecondaryCards />
        </Suspense>
      }
    />
  );
}
