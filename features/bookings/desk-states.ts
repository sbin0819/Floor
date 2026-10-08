import {
  isDeskPartSelectable,
  type DeskPart,
} from "@/features/bookings/desk-parts";
import type { DeskPartSummary, DeskState } from "@/features/bookings/types";

type Range = { start: Date; end: Date };
const overlaps = (a: Range, b: Range) => a.start < b.end && b.start < a.end;

export function summarizeDesks({
  desks,
  bookings,
  blocks,
  parts,
  userId,
  now,
}: {
  desks: readonly {
    id: string;
    name: string;
    parentId: string;
    bookable: boolean;
  }[];
  bookings: readonly { spaceId: string; userId: string; during: Range }[];
  blocks: readonly { spaceId: string; during: Range }[];
  parts: readonly { part: DeskPart; start: string; end: string }[];
  userId: string;
  now: Date;
}): {
  states: Map<string, Partial<Record<DeskPart, DeskState>>>;
  parts: DeskPartSummary[];
} {
  const states = new Map<string, Partial<Record<DeskPart, DeskState>>>(
    desks.map(({ id }) => [id, {}]),
  );
  const summaries = parts.map((part) => {
    const range = { start: new Date(part.start), end: new Date(part.end) };
    let freeCount = 0;
    let myDeskName: string | null = null;
    for (const desk of desks) {
      const relevant = bookings.filter(
        (booking) =>
          booking.spaceId === desk.id && overlaps(booking.during, range),
      );
      const mine = relevant.some((booking) => booking.userId === userId);
      const state: DeskState = !desk.bookable
        ? "unavailable"
        : blocks.some(
              (block) =>
                (block.spaceId === desk.id ||
                  block.spaceId === desk.parentId) &&
                overlaps(block.during, range),
            )
          ? "blocked"
          : mine
            ? "mine"
            : relevant.length
              ? "booked"
              : "free";
      states.get(desk.id)![part.part] = state;
      if (state === "free") freeCount++;
      if (state === "mine") myDeskName ??= desk.name;
    }
    return {
      ...part,
      selectable: isDeskPartSelectable(part.part, parts, now),
      freeCount,
      myDeskName,
    };
  });
  return { states, parts: summaries };
}
