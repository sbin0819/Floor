import { Suspense } from "react";
import { PageContainer } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { requirePageSession } from "@/lib/auth/session";
import { getNotifications } from "@/features/notifications/queries";
import { NotificationListSkeleton } from "@/features/notifications/components/notification-list-skeleton";
import { NotificationsFeed } from "@/features/notifications/components/notifications-feed";

async function NotificationsContent() {
  await requirePageSession("/notifications");
  return <NotificationsFeed initialData={await getNotifications()} />;
}

function NotificationsFallback() {
  return (
    <>
      <Button variant="ghost" disabled className="justify-self-end">
        모두 읽음
      </Button>
      <div className="col-span-2">
        <NotificationListSkeleton />
      </div>
    </>
  );
}

export default function NotificationsPage() {
  return (
    <PageContainer className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-6">
      <h1 className="text-[26px] font-bold tracking-[-0.025em]">알림</h1>
      <Suspense fallback={<NotificationsFallback />}>
        <NotificationsContent />
      </Suspense>
    </PageContainer>
  );
}
