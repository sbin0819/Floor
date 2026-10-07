import { requirePageSession } from "@/lib/auth/session";
import { getTeamStartData } from "@/features/teams/queries";
import { TeamStart } from "@/features/teams/components/team-start";

export default async function TeamStartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { q } = await searchParams;
  await requirePageSession(
    typeof q === "string"
      ? `/teams/start?q=${encodeURIComponent(q)}`
      : "/teams/start",
  );
  return <TeamStart data={await getTeamStartData(q)} />;
}
