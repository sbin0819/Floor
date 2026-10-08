import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getTeamsData } from "@/features/teams/queries";
import {
  TeamsHubContent,
  TeamsShell,
} from "@/features/teams/components/teams-hub";
import { TeamsContentSkeleton } from "@/features/teams/components/team-skeletons";

async function TeamsContent() {
  await requirePageSession("/teams");
  return <TeamsHubContent data={await getTeamsData()} />;
}
export default function TeamsPage() {
  return (
    <TeamsShell>
      <Suspense fallback={<TeamsContentSkeleton />}>
        <TeamsContent />
      </Suspense>
    </TeamsShell>
  );
}
