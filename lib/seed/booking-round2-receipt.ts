import { createHash } from "node:crypto";
import { z } from "zod";

const digest = z.string().regex(/^[a-f0-9]{64}$/u);

export const bookingRound2ReceiptSchema = z.strictObject({
  version: z.literal(1),
  mode: z.literal("booking-round2"),
  hostHash: digest,
  manifestHash: digest,
  appliedAt: z.iso.datetime(),
  bundleHash: digest,
});

export type BookingRound2Receipt = z.infer<typeof bookingRound2ReceiptSchema>;

export function hashBookingRound2Value(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function bookingRound2HostHash(host: string): string {
  return createHash("sha256").update(host.toLowerCase()).digest("hex");
}

export function parseBookingRound2Receipt(
  input: unknown,
): BookingRound2Receipt {
  return bookingRound2ReceiptSchema.parse(input);
}
