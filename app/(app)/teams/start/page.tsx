import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getTeamStartData } from "@/features/teams/queries";
import { TeamStart } from "@/features/teams/components/team-start";
import { TeamStartLoading } from "@/features/teams/components/team-start-shell";
import {
  normalizeTeamStartMode,
  type TeamStartMode,
} from "@/features/teams/start-mode";

type TeamStartPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

async function TeamStartContent({ searchParams }: TeamStartPageProps) {
  const { q, mode } = await searchParams;
  const params = new URLSearchParams();
  if (typeof mode === "string") params.set("mode", mode);
  if (typeof q === "string") params.set("q", q);
  const normalizedMode = normalizeTeamStartMode(mode);
  return (
    <Suspense fallback={<TeamStartLoading mode={normalizedMode} />}>
      <TeamStartData
        mode={normalizedMode}
        query={q}
        next={`/teams/start${params.size ? `?${params}` : ""}`}
      />
    </Suspense>
  );
}

async function TeamStartData({
  mode,
  query,
  next,
}: {
  mode: TeamStartMode;
  query: unknown;
  next: string;
}) {
  await requirePageSession(next);
  return <TeamStart mode={mode} data={await getTeamStartData(query, mode)} />;
}

export default function TeamStartPage(props: TeamStartPageProps) {
  return (
    <Suspense fallback={<TeamStartLoading />}>
      <TeamStartContent {...props} />
    </Suspense>
  );
}
