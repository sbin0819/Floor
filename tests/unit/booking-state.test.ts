import { describe, expect, it } from "vitest";
import { normalizeBookingDate } from "@/features/bookings/query-factory";
import { createBookingSchema } from "@/features/bookings/schema";
import { getSpaceStatus } from "@/features/bookings/status";
import {
  canCancelBooking,
  canSeeBookingTitle,
} from "@/features/bookings/visibility";
import type { PermissionContext } from "@/lib/permissions/types";

const now = new Date("2026-10-07T01:30:00Z");
const range = {
  start: new Date("2026-10-07T01:00:00Z"),
  end: new Date("2026-10-07T02:00:00Z"),
};
const context: PermissionContext = {
  userId: "viewer",
  teams: [{ teamId: "team", role: "member" }],
  staffBranchIds: ["branch"],
  roleSettings: {},
};

describe("booking states and public input", () => {
  const input = {
    spaceId: crypto.randomUUID(),
    start: "2026-10-07T10:00:00+09:00",
    end: "2026-10-07T11:00:00+09:00",
    teamId: null,
  };
  it("accepts offset ISO instants, trims titles and treats blanks as absent", () => {
    expect(
      createBookingSchema.parse({ ...input, title: "  회의  " }).title,
    ).toBe("회의");
    expect(
      createBookingSchema.parse({ ...input, title: "  " }).title,
    ).toBeNull();
    expect(createBookingSchema.parse(input).title).toBeNull();
    expect(
      createBookingSchema.safeParse({
        ...input,
        start: "2026-10-07T01:00:00.000Z",
      }).success,
    ).toBe(true);
  });
  it.each([
    { start: "2026-10-07T10:00:00" },
    { title: "가".repeat(61) },
    { userId: "forged" },
    { role: "operator" },
    { branchId: crypto.randomUUID() },
    { teamId: "invalid" },
  ])("rejects invalid or caller-controlled fields %j", (change) => {
    expect(createBookingSchema.safeParse({ ...input, ...change }).success).toBe(
      false,
    );
  });
  it.each([
    undefined,
    ["2026-10-07"],
    "2026-02-30",
    "2026-1-01",
    "2026-10-06",
    "2026-12-07",
    "<private>",
  ])("defaults invalid date %j to branch-local today", (date) => {
    expect(normalizeBookingDate(date, now, "Asia/Seoul")).toBe("2026-10-07");
  });
  it("allows today through day sixty and uses the branch date across midnight", () => {
    expect(normalizeBookingDate("2026-12-06", now, "Asia/Seoul")).toBe(
      "2026-12-06",
    );
    expect(
      normalizeBookingDate(
        undefined,
        new Date("2026-10-06T16:00:00Z"),
        "Asia/Seoul",
      ),
    ).toBe("2026-10-07");
  });
  const status = (
    options: Partial<Parameters<typeof getSpaceStatus>[0]> = {},
  ) =>
    getSpaceStatus({
      accessible: true,
      now,
      blocks: [],
      bookings: [],
      userId: "viewer",
      teamIds: ["team"],
      ...options,
    });
  it("uses restricted then maintenance then other-user busy then own/team then free priority", () => {
    const own = { ...range, userId: "viewer", teamId: null };
    const other = { ...range, userId: "other", teamId: null };
    expect(
      status({ accessible: false, blocks: [range], bookings: [other, own] }),
    ).toBe("restricted");
    expect(status({ blocks: [range], bookings: [other, own] })).toBe(
      "maintenance",
    );
    expect(status({ bookings: [other, own] })).toBe("busy");
    expect(status({ bookings: [own] })).toBe("mine");
    expect(status({ bookings: [{ ...other, teamId: "team" }] })).toBe("mine");
    expect(status()).toBe("free");
    expect(status({ now: range.end, bookings: [own], blocks: [range] })).toBe(
      "free",
    );
    expect(status({ now: range.start, bookings: [own] })).toBe("mine");
  });
  it("shares titles only with owners, matching team members and local operators", () => {
    expect(
      canSeeBookingTitle(
        context,
        { userId: "viewer", teamId: null },
        "elsewhere",
      ),
    ).toBe(true);
    expect(
      canSeeBookingTitle(
        context,
        { userId: "other", teamId: "team" },
        "elsewhere",
      ),
    ).toBe(true);
    expect(
      canSeeBookingTitle(context, { userId: "other", teamId: null }, "branch"),
    ).toBe(true);
    expect(
      canSeeBookingTitle(
        context,
        { userId: "other", teamId: "different" },
        "elsewhere",
      ),
    ).toBe(false);
  });
  it("always permits owner cancellation and respects scoped manage permissions for others", () => {
    const denied = {
      ...context,
      roleSettings: { branch: { user: [], operator: [], team_admin: [] } },
    };
    expect(
      canCancelBooking(denied, { userId: "viewer", teamId: "team" }, "branch"),
    ).toBe(true);
    expect(
      canCancelBooking(denied, { userId: "other", teamId: null }, "branch"),
    ).toBe(false);
    expect(
      canCancelBooking(context, { userId: "other", teamId: null }, "branch"),
    ).toBe(true);
    expect(
      canCancelBooking(
        context,
        { userId: "other", teamId: "team" },
        "elsewhere",
      ),
    ).toBe(false);
    expect(
      canCancelBooking(
        { ...context, teams: [{ teamId: "team", role: "admin" }] },
        { userId: "other", teamId: "team" },
        "elsewhere",
      ),
    ).toBe(true);
  });
});
