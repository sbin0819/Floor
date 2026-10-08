import { Suspense } from "react";
import { PageContainer, PageHeading } from "@/components/page-container";
import { Skeleton } from "@/components/ui/skeleton";
import { requirePageSession } from "@/lib/auth/session";
import { RateLimitError } from "@/lib/rate-limit/memory";
import { getInvitePreview } from "@/features/chat/space-invite-queries";
import { SpaceJoin } from "@/features/chat/components/space-join";

type Props = { params: Promise<{ code: string }> };
async function InviteContent({ params }: Props) {
  const { code } = await params;
  await requirePageSession(`/s/join/${encodeURIComponent(code)}`);
  let preview;
  try {
    preview = await getInvitePreview(code);
  } catch (error) {
    if (error instanceof RateLimitError)
      return <p role="alert">잠시 뒤에 다시 해 주세요</p>;
    throw error;
  }
  return <SpaceJoin code={code} preview={preview} />;
}
export default function InvitePage(props: Props) {
  return (
    <PageContainer as="main" width="form" className="space-y-6">
      <PageHeading title="스페이스 초대" />
      <Suspense
        fallback={
          <div
            aria-busy="true"
            role="status"
            aria-label="초대를 확인하고 있어요"
          >
            <Skeleton className="h-64 w-full" />
          </div>
        }
      >
        <InviteContent {...props} />
      </Suspense>
    </PageContainer>
  );
}
