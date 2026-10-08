import { Suspense } from "react";
import { PageContainer, PageHeading } from "@/components/page-container";
import { Skeleton } from "@/components/ui/skeleton";
import { requirePageSession } from "@/lib/auth/session";
import { getMessageContacts } from "@/features/people/queries";
import { MessageContacts } from "@/features/chat/components/message-contacts";

async function ContactsContent() {
  await requirePageSession("/messages/new");
  return <MessageContacts people={await getMessageContacts()} />;
}
export default function NewMessagePage() {
  return (
    <PageContainer as="main" className="space-y-6">
      <PageHeading title="새 메시지" />
      <Suspense
        fallback={
          <div aria-busy="true" className="space-y-6">
            <span role="status" className="sr-only">
              연락처를 불러오고 있어요
            </span>
            <p className="text-sm font-medium">이름으로 거르기</p>
            <Skeleton className="h-11 w-full" />
            <h2 className="text-sm font-semibold">친구</h2>
            <Skeleton className="h-20 w-full" />
            <h2 className="text-sm font-semibold">같은 팀</h2>
            <Skeleton className="h-20 w-full" />
          </div>
        }
      >
        <ContactsContent />
      </Suspense>
    </PageContainer>
  );
}
