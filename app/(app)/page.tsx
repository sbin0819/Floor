import { Suspense } from "react";
import Link from "next/link";
import { requirePageSession } from "@/lib/auth/session";
import { getAccountMenuData } from "@/features/auth/queries";
import {
  HomeDashboardFrame,
  HomeDashboardRows,
} from "@/features/bookings/components/home-frame";
import {
  getHomeHeader,
  getHomeUpcomingBookings,
  getHomeFreeSpaces,
  getHomeBookingLimits,
  getHomeWeekBookings,
  getHomeFrequentSpaces,
} from "@/features/bookings/queries";
import {
  getHomeChecklist,
  getHomeRecentChats,
  getHomeTodo,
} from "@/features/home/queries";
import type {
  HomeChecklist as ChecklistData,
  HomeRecentChat,
} from "@/features/home/types";
import { HomeChecklist } from "@/features/home/components/home-checklist";
import { HomeRecentChats } from "@/features/home/components/home-recent-chats";
import { HomeTodo } from "@/features/home/components/home-todo";
import { HomeRefresh } from "@/features/home/components/home-refresh";
import {
  HomeGreeting,
  HomeUpcomingBookings,
  HomeFreeSpaces,
  HomeBookingLimits,
} from "@/features/bookings/components/home-dashboard";
import {
  HomeWeekBookings,
  HomeFrequentSpaces,
} from "@/features/bookings/components/home-secondary-cards";
import {
  HomeGreetingSkeleton,
  HomeCardSkeleton,
  HomeRowsSkeleton,
} from "@/features/bookings/components/home-skeletons";
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
async function Todo() {
  return <HomeTodo data={await getHomeTodo()} />;
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

type Placement = {
  checklist: Promise<ChecklistData>;
  chats: Promise<HomeRecentChat[]>;
};
async function FirstRow({ checklist, chats }: Placement) {
  const [guide, recent] = await Promise.all([checklist, chats]);
  return (
    <>
      <div className="min-w-0">
        {guide.visible ? (
          <HomeChecklist data={guide} />
        ) : (
          <Suspense fallback={<HomeNextBookingSkeleton />}>
            <Upcoming />
          </Suspense>
        )}
      </div>
      <div className="min-w-0">
        {guide.visible || recent.length === 0 ? (
          <Suspense fallback={<HomeFreeSpacesSkeleton />}>
            <FreeSpaces />
          </Suspense>
        ) : (
          <HomeRecentChats data={recent} />
        )}
      </div>
    </>
  );
}
async function ThirdRowFreeSpaces({ checklist, chats }: Placement) {
  const [guide, recent] = await Promise.all([checklist, chats]);
  if (guide.visible || recent.length === 0) return null;
  return (
    <Suspense fallback={<HomeFreeSpacesSkeleton />}>
      <FreeSpaces />
    </Suspense>
  );
}

async function Content() {
  const session = await requirePageSession("/");
  // 배치를 정하는 두 결과를 같은 요청의 두 자리가 나눠 쓴다.
  const checklist = getHomeChecklist();
  const chats = getHomeRecentChats();
  return (
    <>
      <HomeRefresh userId={session.userId} />
      <HomeDashboardRows
        todo={
          <Suspense fallback={null}>
            <Todo />
          </Suspense>
        }
        firstRow={
          <Suspense
            fallback={
              <>
                <HomeNextBookingSkeleton />
                <HomeFreeSpacesSkeleton />
              </>
            }
          >
            <FirstRow checklist={checklist} chats={chats} />
          </Suspense>
        }
        week={
          <Suspense fallback={<HomeWeekBookingsSkeleton />}>
            <WeekBookings />
          </Suspense>
        }
        thirdRow={
          <>
            <Suspense fallback={null}>
              <ThirdRowFreeSpaces checklist={checklist} chats={chats} />
            </Suspense>
            <Suspense fallback={<HomeCardSkeleton rows={1} />}>
              <Limits />
            </Suspense>
            <Suspense fallback={<HomeFrequentSpacesSkeleton />}>
              <FrequentSpaces />
            </Suspense>
          </>
        }
        operator={
          <Suspense fallback={null}>
            <OperatorLink />
          </Suspense>
        }
      />
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
    >
      <Suspense fallback={<HomeRowsSkeleton />}>
        <Content />
      </Suspense>
    </HomeDashboardFrame>
  );
}
