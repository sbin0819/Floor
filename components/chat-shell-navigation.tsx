import Link from "next/link";
import { Grid2X2 } from "lucide-react";
import {
  LiveChatRail,
  LiveChatSidebar,
  LiveChatSidebarTitle,
  ChatNavSync,
} from "@/features/chat/components/chat-nav";
import { getSession } from "@/lib/auth/session";
import { getMyChatNav } from "@/features/chat/queries";

async function readNavigation() {
  return (await getSession())
    ? getMyChatNav()
    : {
        spaces: [],
        directMessages: [],
        myStatus: "online" as const,
        blockedUserIds: [],
      };
}

export async function ChatRailSlot() {
  return <LiveChatRail data={await readNavigation()} />;
}

export async function ChatSidebarSlot() {
  return <LiveChatSidebar data={await readNavigation()} />;
}

export async function ChatSidebarTitleSlot() {
  return <LiveChatSidebarTitle data={await readNavigation()} />;
}

export async function ChatNavSyncSlot() {
  const session = await getSession();
  return session ? (
    <ChatNavSync userId={session.userId} initialData={await getMyChatNav()} />
  ) : null;
}

export function ChatRailPlaceholder() {
  return (
    <div aria-busy="true" className="flex w-full flex-col items-center gap-3">
      <span role="status" className="sr-only">
        스페이스를 불러오고 있어요
      </span>
      <Link
        href="/"
        aria-label="Floor 홈"
        className="flex size-11 items-center justify-center rounded-xl bg-card text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <Grid2X2 aria-hidden="true" className="size-5" />
      </Link>
      <span aria-hidden="true" className="h-px w-10 bg-sidebar-border" />
      <span aria-hidden="true" className="size-11 rounded-xl bg-muted" />
    </div>
  );
}

export function ChatSidebarTitlePlaceholder() {
  return (
    <div aria-busy="true" className="flex h-11 items-center">
      <span role="status" className="sr-only">
        불러오고 있어요
      </span>
      <span aria-hidden="true" className="h-5 w-24 rounded bg-muted" />
    </div>
  );
}
