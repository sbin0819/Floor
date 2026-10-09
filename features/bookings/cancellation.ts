import { z } from "zod";

export type BookingCancellation = {
  kind: "operator" | "maintenance";
  reason: string;
};

export const cancellationKindSchema = z.enum(["operator", "maintenance"]);
export const cancellationReasonSchema = z.string().refine((reason) => {
  const length = Array.from(reason).length;
  return length >= 1 && length <= 200;
});

export function bookingCancellationText(booking: {
  cancelKind?: BookingCancellation["kind"] | null;
  cancelReason?: string | null;
}) {
  if (!booking.cancelKind || !booking.cancelReason) return "취소됨";
  return `${booking.cancelKind === "operator" ? "운영자가 취소함" : "점검으로 취소됨"} · ${booking.cancelReason}`;
}
