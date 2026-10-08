import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getMeetingView } from "@/features/chat/queries";
import { MeetingScreen } from "@/features/chat/components/channel-screen";
import { ChannelSkeleton } from "@/features/chat/components/channel-skeleton";

type Props = { params: Promise<{ bookingId: string }> };
async function MeetingContent({ params }: Props) {
  const { bookingId } = await params;
  await requirePageSession(`/m/${bookingId}`);
  const data = await getMeetingView(bookingId);
  if (!data) notFound();
  return <MeetingScreen key={data.room.id} data={data} />;
}
export default function MeetingPage(props: Props) {
  return (
    <Suspense fallback={<ChannelSkeleton />}>
      <MeetingContent {...props} />
    </Suspense>
  );
}
