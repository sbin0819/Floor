import type { SpaceStatus } from "@/features/bookings/types";

type Range = { start: Date; end: Date };
export function getSpaceStatus({
  accessible,
  now,
  blocks,
  bookings,
  userId,
  teamIds,
}: {
  accessible: boolean;
  now: Date;
  blocks: Range[];
  bookings: (Range & { userId: string; teamId: string | null })[];
  userId: string;
  teamIds: string[];
}): SpaceStatus {
  if (!accessible) return "restricted";
  const active = (range: Range) => range.start <= now && now < range.end;
  if (blocks.some(active)) return "maintenance";
  const mine = (booking: { userId: string; teamId: string | null }) =>
    booking.userId === userId ||
    (booking.teamId !== null && teamIds.includes(booking.teamId));
  if (bookings.some((booking) => active(booking) && !mine(booking)))
    return "busy";
  if (bookings.some((booking) => active(booking) && mine(booking)))
    return "mine";
  return "free";
}
