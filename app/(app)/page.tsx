import { requirePageSession } from "@/lib/auth/session";
import { getHomeData } from "@/features/teams/queries";
import { TeamHome } from "@/features/teams/components/team-home";

export default async function Home() {
  await requirePageSession("/");
  return <TeamHome data={await getHomeData()} />;
}
