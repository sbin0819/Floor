import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getTeamPageData } from "@/features/teams/queries";
import { TeamDetail } from "@/features/teams/components/team-detail";

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
    <Suspense
      fallback={
        <p role="status" className="p-6 text-muted-foreground">
          팀 정보를 불러오고 있어요.
        </p>
      }
    >
      <TeamPageContent {...props} />
    </Suspense>
  );
}
