import { describe, expect, it } from "vitest";
import { createDeskParts } from "@/features/bookings/desk-parts";
import { summarizeDesks } from "@/features/bookings/desk-states";

const during = (start: string, end: string) => ({
  start: new Date(`2026-10-08T${start}:00+09:00`),
  end: new Date(`2026-10-08T${end}:00+09:00`),
});
const parts = createDeskParts({
  date: "2026-10-08",
  timeZone: "Asia/Seoul",
  openHours: { thu: { open: "08:00", close: "22:00" } },
});
const now = new Date("2026-10-08T11:00:00+09:00");
const desks = Array.from({ length: 5 }, (_, i) => ({
  id: String(i),
  name: `A-${i}`,
  parentId: "area",
  bookable: i !== 0,
}));
describe("desk availability summaries", () => {
  it("prioritizes unavailable, blocks, own, other, and free without exposing occupant fields", () => {
    const data = summarizeDesks({
      desks,
      parts,
      now,
      userId: "me",
      bookings: [
        { spaceId: "0", userId: "me", during: during("08:00", "13:00") },
        { spaceId: "1", userId: "me", during: during("08:00", "13:00") },
        { spaceId: "2", userId: "me", during: during("08:00", "13:00") },
        { spaceId: "3", userId: "other", during: during("08:00", "13:00") },
      ],
      blocks: [
        { spaceId: "0", during: during("08:00", "13:00") },
        { spaceId: "1", during: during("08:00", "13:00") },
      ],
    });
    expect(desks.map(({ id }) => data.states.get(id)?.am)).toEqual([
      "unavailable",
      "blocked",
      "mine",
      "booked",
      "free",
    ]);
    expect(data.parts[0]).toMatchObject({
      freeCount: 1,
      myDeskName: "A-2",
      selectable: true,
    });
    expect(data.parts[1]).toMatchObject({ freeCount: 4, myDeskName: null });
    expect(data.parts[2]).toMatchObject({ freeCount: 1, myDeskName: "A-2" });
    expect(JSON.stringify(data.parts)).not.toContain("other");
  });
  it("applies area blocks to all desks only in overlapping parts and retains ended statuses", () => {
    const data = summarizeDesks({
      desks,
      parts,
      now: new Date("2026-10-08T23:00:00+09:00"),
      userId: "me",
      bookings: [],
      blocks: [{ spaceId: "area", during: during("13:00", "14:00") }],
    });
    expect(data.states.get("1")).toEqual({
      am: "free",
      pm: "blocked",
      day: "blocked",
    });
    expect(data.parts.map(({ freeCount }) => freeCount)).toEqual([4, 0, 0]);
    expect(data.parts.every(({ selectable }) => !selectable)).toBe(true);
  });
  it("returns no fictitious seat or part when the area is empty or closed", () => {
    expect(
      summarizeDesks({
        desks: [],
        parts,
        now,
        userId: "me",
        bookings: [],
        blocks: [],
      }).parts.every(({ freeCount }) => freeCount === 0),
    ).toBe(true);
    const closed = summarizeDesks({
      desks,
      parts: [],
      now,
      userId: "me",
      bookings: [],
      blocks: [],
    });
    expect(closed.parts).toEqual([]);
    expect([...closed.states.values()]).toEqual([{}, {}, {}, {}, {}]);
  });
});
