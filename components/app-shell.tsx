import { Suspense, type ReactNode } from "react";
import { AppShellFrame } from "@/components/app-shell-frame";
import {
  ChatRailSlot,
  ChatRailPlaceholder,
  ChatSidebarSlot,
  ChatSidebarTitleSlot,
  ChatSidebarTitlePlaceholder,
  ChatNavSyncSlot,
} from "@/components/chat-shell-navigation";
import {
  RealtimeProvider,
  RealtimeSession,
} from "@/components/realtime-provider";
import {
  HeaderAccount,
  AccountMenuPlaceholder,
} from "@/components/shell-account";
import { getSession } from "@/lib/auth/session";
import { getNotificationSummary } from "@/features/notifications/queries";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { ChatQueueConnection } from "@/features/chat/components/use-chat-send-queue";

export async function HeaderNotifications() {
  if (!(await getSession())) return null;
  return <NotificationBell initialData={await getNotificationSummary()} />;
}

export function NotificationBellPlaceholder() {
  return (
    <div aria-busy="true" className="flex size-11 items-center justify-center">
      <span aria-hidden="true" className="size-10 rounded-full bg-muted" />
      <span className="sr-only" role="status">
        알림을 불러오고 있어요
      </span>
    </div>
  );
}

export function MemberNavPlaceholder() {
  return (
    <div aria-busy="true" className="flex flex-col gap-1">
      <span role="status" className="sr-only">
        불러오고 있어요
      </span>
      {[0, 1, 2, 3].map((key) => (
        <span
          key={key}
          aria-hidden="true"
          className="h-11 rounded-sm bg-muted"
        />
      ))}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <RealtimeProvider>
      <Suspense fallback={null}>
        <ShellRealtimeSession />
      </Suspense>
      <AppShellFrame
        rail={
          <Suspense fallback={<ChatRailPlaceholder />}>
            <ChatRailSlot />
          </Suspense>
        }
        sidebarTitle={
          <Suspense fallback={<ChatSidebarTitlePlaceholder />}>
            <ChatSidebarTitleSlot />
          </Suspense>
        }
        menu={
          <Suspense fallback={<MemberNavPlaceholder />}>
            <ChatSidebarSlot />
          </Suspense>
        }
        accountCard={
          <Suspense fallback={<AccountMenuPlaceholder variant="card" />}>
            <HeaderAccount variant="card" />
          </Suspense>
        }
        accountAvatar={
          <Suspense fallback={<AccountMenuPlaceholder variant="avatar" />}>
            <HeaderAccount variant="avatar" />
          </Suspense>
        }
        notifications={
          <Suspense fallback={<NotificationBellPlaceholder />}>
            <HeaderNotifications />
          </Suspense>
        }
      >
        {children}
      </AppShellFrame>
      <Suspense fallback={null}>
        <ChatNavSyncSlot />
      </Suspense>
      <ChatQueueConnection />
    </RealtimeProvider>
  );
}

export async function ShellRealtimeSession() {
  const session = await getSession();
  return session ? <RealtimeSession userId={session.userId} /> : null;
}
