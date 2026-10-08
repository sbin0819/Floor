import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requirePageSession } from "@/lib/auth/session";
import { getMyChatNav } from "@/features/chat/queries";
import {
  MessagesShell,
  MessagesSkeleton,
} from "@/features/chat/components/messages-list";

type SpacePageProps = { params: Promise<{ spaceId: string }> };

async function SpaceContent({ params }: SpacePageProps) {
  const { spaceId } = await params;
  await requirePageSession(`/s/${encodeURIComponent(spaceId)}`);
  if (!z.uuid().safeParse(spaceId).success) notFound();
  const spaces = await getMyChatNav();
  const channel = spaces.find(({ id }) => id === spaceId.toLowerCase())
    ?.channels[0];
  if (!channel) notFound();
  return redirect(`/s/${spaceId.toLowerCase()}/${channel.id}`);
}

export default function SpacePage(props: SpacePageProps) {
  return (
    <MessagesShell>
      <Suspense fallback={<MessagesSkeleton />}>
        <SpaceContent {...props} />
      </Suspense>
    </MessagesShell>
  );
}
