import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getTeamPageData } from "@/features/teams/queries";
import { TeamDetail } from "@/features/teams/components/team-detail";
import { TeamDetailSkeleton } from "@/features/teams/components/team-skeletons";

type TeamPageProps = {
  params: Promise<{ teamId: string }>;
};

async function TeamPageContent({ params }: TeamPageProps) {
  const { teamId } = await params;
  await requirePageSession(`/teams/${encodeURIComponent(teamId)}`);
  const data = await getTeamPageData(teamId);
  if (!data) notFound();
  return <TeamDetail data={data} />;
}

export default function TeamPage(props: TeamPageProps) {
  return (
    <Suspense fallback={<TeamDetailSkeleton />}>
      <TeamPageContent {...props} />
    </Suspense>
  );
}
