import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getHomeData } from "@/features/teams/queries";
import { TeamHome } from "@/features/teams/components/team-home";
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
    <Suspense
      fallback={
        <p role="status" className="p-6 text-muted-foreground">
          홈을 불러오고 있어요.
        </p>
      }
    >
      <HomeContent />
    </Suspense>
  );
}
