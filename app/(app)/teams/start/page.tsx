import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getTeamStartData } from "@/features/teams/queries";
import { TeamStart } from "@/features/teams/components/team-start";
import { TeamStartSkeleton } from "@/features/teams/components/team-skeletons";

type TeamStartPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function TeamStartContent({ searchParams }: TeamStartPageProps) {
  const { q } = await searchParams;
  await requirePageSession(
    typeof q === "string"
      ? `/teams/start?q=${encodeURIComponent(q)}`
      : "/teams/start",
  );
  return <TeamStart data={await getTeamStartData(q)} />;
}

export default function TeamStartPage(props: TeamStartPageProps) {
  return (
    <Suspense fallback={<TeamStartSkeleton />}>
      <TeamStartContent {...props} />
    </Suspense>
  );
}
