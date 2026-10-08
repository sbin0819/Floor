import { Badge } from "@/components/ui/badge";
import { participantSummary } from "@/features/bookings/booking-presentation";
import type { MyBooking } from "@/features/bookings/types";

export function BookingParticipantsSummary({
  booking,
}: {
  booking: Pick<MyBooking, "relation" | "invitedByName" | "participantNames">;
}) {
  const summary = participantSummary(booking.participantNames);
  if (booking.relation !== "invited" && !summary) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      {booking.relation === "invited" && (
        <>
          <Badge variant="secondary">초대받음</Badge>
          {booking.invitedByName && (
            <span>{booking.invitedByName} 님이 초대</span>
          )}
        </>
      )}
      {summary && <span>{summary}</span>}
    </div>
  );
}
