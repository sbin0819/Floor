import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getTeamStartData } from "@/features/teams/queries";
import { TeamStart } from "@/features/teams/components/team-start";
import { TeamStartSkeleton } from "@/features/teams/components/team-skeletons";
import { normalizeTeamStartMode } from "@/features/teams/start-mode";

type TeamStartPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function TeamStartContent({ searchParams }: TeamStartPageProps) {
  const { q, mode } = await searchParams;
  const params = new URLSearchParams();
  if (typeof mode === "string") params.set("mode", mode);
  if (typeof q === "string") params.set("q", q);
  await requirePageSession(`/teams/start${params.size ? `?${params}` : ""}`);
  return (
    <TeamStart
      mode={normalizeTeamStartMode(mode)}
      data={await getTeamStartData(q)}
    />
  );
}

export default function TeamStartPage(props: TeamStartPageProps) {
  return (
    <Suspense fallback={<TeamStartSkeleton />}>
      <TeamStartContent {...props} />
    </Suspense>
  );
}
