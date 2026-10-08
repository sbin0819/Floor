import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getChannelView } from "@/features/chat/queries";
import { ChannelScreen } from "@/features/chat/components/channel-screen";
import { ChannelSkeleton } from "@/features/chat/components/channel-skeleton";
import { SpaceAccessBoundary } from "@/features/chat/components/space-access-boundary";

type ChannelPageProps = {
  params: Promise<{ spaceId: string; roomId: string }>;
};

async function ChannelContent({ params }: ChannelPageProps) {
  const { spaceId, roomId } = await params;
  await requirePageSession(
    `/s/${encodeURIComponent(spaceId)}/${encodeURIComponent(roomId)}`,
  );
  const data = await getChannelView(spaceId, roomId);
  if (!data) notFound();
  return (
    <SpaceAccessBoundary spaceId={spaceId.toLowerCase()}>
      <ChannelScreen key={data.room.id} data={data} />
    </SpaceAccessBoundary>
  );
}

export default function ChannelPage(props: ChannelPageProps) {
  return (
    <Suspense fallback={<ChannelSkeleton />}>
      <ChannelContent {...props} />
    </Suspense>
  );
}
