import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getInvitePageData } from "@/features/teams/queries";
import { InviteDetail } from "@/features/teams/components/invite-detail";
import { InviteSkeleton } from "@/features/teams/components/team-skeletons";

type InvitePageProps = {
  params: Promise<{ token: string }>;
};

async function InvitePageContent({ params }: InvitePageProps) {
  const { token } = await params;
  await requirePageSession(`/invite/${encodeURIComponent(token)}`);
  return <InviteDetail data={await getInvitePageData(token)} />;
}

export default function InvitePage(props: InvitePageProps) {
  return (
    <Suspense fallback={<InviteSkeleton />}>
      <InvitePageContent {...props} />
    </Suspense>
  );
}
