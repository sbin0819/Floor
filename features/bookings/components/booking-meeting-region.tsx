import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getMeetingView } from "@/features/chat/queries";
import { MeetingScreen } from "@/features/chat/components/channel-screen";
import { bookingPageHref } from "../meeting-navigation";
import {
  BookingMeetingPending,
  BookingMeetingSheet,
  BookingMeetingSheetActions,
} from "./booking-meeting-sheet";

async function MeetingContent({ bookingId }: { bookingId: string }) {
  const data = await getMeetingView(bookingId);
  const actions = <BookingMeetingSheetActions bookingId={bookingId} />;
  if (!data)
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <p className="font-semibold">예약 채팅</p>
          {actions}
        </div>
        <p className="p-5 text-sm text-muted-foreground">
          이 회의를 볼 수 없어요
        </p>
      </div>
    );
  return <MeetingScreen data={data} variant="sheet" actions={actions} />;
}

export async function BookingMeetingRegion({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const bookingId =
    query?.chat === undefined
      ? null
      : typeof query.chat === "string"
        ? query.chat
        : "";
  if (bookingId !== null) await requirePageSession(bookingPageHref(query));
  return (
    <BookingMeetingSheet bookingId={bookingId}>
      {bookingId !== null && (
        <Suspense
          key={bookingId}
          fallback={<BookingMeetingPending bookingId={bookingId} />}
        >
          <MeetingContent bookingId={bookingId} />
        </Suspense>
      )}
    </BookingMeetingSheet>
  );
}
