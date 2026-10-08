import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requirePageSession } from "@/lib/auth/session";
import { getDirectMessageView } from "@/features/chat/queries";
import { DirectMessageScreen } from "@/features/chat/components/channel-screen";
import { ChannelSkeleton } from "@/features/chat/components/channel-skeleton";
import { getMessageContacts } from "@/features/people/queries";

type Props = { params: Promise<{ roomId: string }> };
async function DirectContent({ params }: Props) {
  const { roomId } = await params;
  await requirePageSession(`/dm/${roomId}`);
  const data = await getDirectMessageView(roomId);
  if (!data) notFound();
  const contacts = data.kind === "group_dm" ? getMessageContacts() : undefined;
  return (
    <DirectMessageScreen key={data.room.id} data={data} contacts={contacts} />
  );
}
export default function DirectPage(props: Props) {
  return (
    <Suspense fallback={<ChannelSkeleton />}>
      <DirectContent {...props} />
    </Suspense>
  );
}
