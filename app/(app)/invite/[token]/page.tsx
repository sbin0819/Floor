import { requirePageSession } from "@/lib/auth/session";
import { getInvitePageData } from "@/features/teams/queries";
import { InviteDetail } from "@/features/teams/components/invite-detail";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  await requirePageSession(`/invite/${encodeURIComponent(token)}`);
  return <InviteDetail data={await getInvitePageData(token)} />;
}
