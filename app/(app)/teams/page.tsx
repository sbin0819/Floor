import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getTeamsData } from "@/features/teams/queries";
import { TeamsHub } from "@/features/teams/components/teams-hub";
import { TeamsSkeleton } from "@/features/teams/components/team-skeletons";

async function TeamsContent() {
  await requirePageSession("/teams");
  return <TeamsHub data={await getTeamsData()} />;
}
export default function TeamsPage() {
  return (
    <Suspense fallback={<TeamsSkeleton />}>
      <TeamsContent />
    </Suspense>
  );
}
