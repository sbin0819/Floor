import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getTeamPageData } from "@/features/teams/queries";
import { TeamDetail } from "@/features/teams/components/team-detail";

export default async function TeamPage({
  params,
}: {
  params: Promise<{ teamId: string }>;
}) {
  const { teamId } = await params;
  await requirePageSession(`/teams/${encodeURIComponent(teamId)}`);
  const data = await getTeamPageData(teamId);
  if (!data) notFound();
  return <TeamDetail data={data} />;
}
