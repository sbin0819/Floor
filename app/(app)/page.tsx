import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getHomeData } from "@/features/teams/queries";
import { TeamHome } from "@/features/teams/components/team-home";
import { HomeSkeleton } from "@/features/teams/components/team-skeletons";
import { getBookingEntry } from "@/features/bookings/queries";

async function HomeContent() {
  await requirePageSession("/");
  const [data, branchId] = await Promise.all([
    getHomeData(),
    getBookingEntry(),
  ]);
  return (
    <TeamHome
      data={data}
      bookingHref={branchId ? `/branches/${branchId}` : "/branches"}
    />
  );
}

export default function Home() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <HomeContent />
    </Suspense>
  );
}
