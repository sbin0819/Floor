import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getDirectMessageView } from "@/features/chat/queries";
import { DirectMessageScreen } from "@/features/chat/components/channel-screen";
import { ChannelSkeleton } from "@/features/chat/components/channel-skeleton";

type Props = { params: Promise<{ roomId: string }> };
async function DirectContent({ params }: Props) {
  const { roomId } = await params;
  await requirePageSession(`/dm/${roomId}`);
  const data = await getDirectMessageView(roomId);
  if (!data) notFound();
  return <DirectMessageScreen key={data.room.id} data={data} />;
}
export default function DirectPage(props: Props) {
  return (
    <Suspense fallback={<ChannelSkeleton />}>
      <DirectContent {...props} />
    </Suspense>
  );
}
