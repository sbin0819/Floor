import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getHomeData } from "@/features/teams/queries";
import { TeamHome } from "@/features/teams/components/team-home";

async function HomeContent() {
  await requirePageSession("/");
  return <TeamHome data={await getHomeData()} />;
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
