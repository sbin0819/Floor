import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { requirePageSession } from "@/lib/auth/session";
import { getMyChatNav } from "@/features/chat/queries";
import { defaultSpaceChannel } from "@/features/chat/default-space-channel";
import { ChannelDialog } from "@/features/chat/components/channel-dialog";
import { SpaceAccessBoundary } from "@/features/chat/components/space-access-boundary";
import {
  MessagesShell,
  MessagesSkeleton,
} from "@/features/chat/components/messages-list";

type SpacePageProps = { params: Promise<{ spaceId: string }> };

async function SpaceContent({ params }: SpacePageProps) {
  const { spaceId } = await params;
  await requirePageSession(`/s/${encodeURIComponent(spaceId)}`);
  if (!z.uuid().safeParse(spaceId).success) notFound();
  const { spaces } = await getMyChatNav();
  const space = spaces.find(({ id }) => id === spaceId.toLowerCase());
  if (!space) notFound();
  const channel = defaultSpaceChannel(space);
  if (!channel)
    return (
      <SpaceAccessBoundary spaceId={space.id}>
        <section className="space-y-4 p-6">
          <h1 className="text-2xl font-bold">{space.name}</h1>
          <p>아직 열린 채널이 없어요</p>
          {space.role !== "member" && <ChannelDialog spaceId={space.id} />}
        </section>
      </SpaceAccessBoundary>
    );
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
