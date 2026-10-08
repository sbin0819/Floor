import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getMyChatNav } from "@/features/chat/queries";
import {
  MessagesList,
  MessagesShell,
  MessagesSkeleton,
} from "@/features/chat/components/messages-list";

async function MessagesContent() {
  await requirePageSession("/messages");
  return <MessagesList spaces={await getMyChatNav()} />;
}

export default function MessagesPage() {
  return (
    <MessagesShell>
      <Suspense fallback={<MessagesSkeleton />}>
        <MessagesContent />
      </Suspense>
    </MessagesShell>
  );
}
