import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getChannelView } from "@/features/chat/queries";
import { ChannelScreen } from "@/features/chat/components/channel-screen";
import { ChannelSkeleton } from "@/features/chat/components/channel-skeleton";

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
  return <ChannelScreen key={data.room.id} data={data} />;
}

export default function ChannelPage(props: ChannelPageProps) {
  return (
    <Suspense fallback={<ChannelSkeleton />}>
      <ChannelContent {...props} />
    </Suspense>
  );
}
