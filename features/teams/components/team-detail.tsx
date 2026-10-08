import type { TeamPageData } from "../types";
import { TeamMembers } from "./team-members";
import { TeamRequests } from "./team-requests";

export function TeamDetail({
  data,
  tab = "members",
}: {
  data: TeamPageData;
  tab?: "members" | "requests";
}) {
  return tab === "requests" && data.role === "admin" ? (
    <TeamRequests data={data} />
  ) : (
    <TeamMembers data={data} />
  );
}
