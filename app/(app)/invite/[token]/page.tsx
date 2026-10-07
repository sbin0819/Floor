import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getInvitePageData } from "@/features/teams/queries";
import { InviteDetail } from "@/features/teams/components/invite-detail";

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
    <Suspense
      fallback={
        <p role="status" className="p-6 text-muted-foreground">
          초대를 확인하고 있어요.
        </p>
      }
    >
      <InvitePageContent {...props} />
    </Suspense>
  );
}
