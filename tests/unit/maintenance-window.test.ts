import { describe, expect, it } from "vitest";
import {
  blockIdSchema,
  createMaintenanceSchema,
  ensureMaintenanceSpace,
  maintenanceListSchema,
  previewMaintenanceSchema,
  updateMaintenanceSchema,
  validateMaintenanceWindow,
} from "@/features/admin/maintenance-schema";
import type { MaintenanceStart } from "@/features/admin/maintenance-types";
import { ActionError } from "@/lib/actions/result";

const now = new Date("2026-10-07T03:10:42.345Z");
const at = (value = "2026-10-07T12:30:00+09:00"): MaintenanceStart => ({
  kind: "at",
  at: value,
});
const input = () => ({
  spaceId: crypto.randomUUID(),
  start: at(),
  end: "2026-10-07T13:30:00+09:00",
});
function window(
  start: MaintenanceStart = at(),
  end = "2026-10-07T13:30:00+09:00",
  timeZone = "Asia/Seoul",
  current = now,
) {
  return validateMaintenanceWindow({ start, end, now: current, timeZone });
}
function invalid(run: () => unknown, field: "start" | "end") {
  try {
    run();
    throw new Error("Expected INVALID_INPUT");
  } catch (error) {
    expect(error).toBeInstanceOf(ActionError);
    expect(error).toMatchObject({
      code: "INVALID_INPUT",
      details: { fieldErrors: { [field]: expect.any(Array) } },
    });
  }
}
describe("maintenance schemas", () => {
  it("normalizes UUIDs and offset timestamps without accepting additional fields", () => {
    const value = input();
    expect(
      previewMaintenanceSchema.parse({
        ...value,
        spaceId: value.spaceId.toUpperCase(),
      }),
    ).toEqual({
      spaceId: value.spaceId,
      start: { kind: "at", at: "2026-10-07T03:30:00.000Z" },
      end: "2026-10-07T04:30:00.000Z",
    });
    for (const extra of [
      { branchId: crypto.randomUUID() },
      { userId: crypto.randomUUID() },
      { reason: "미리보기 이유는 보내지 않아요" },
    ])
      expect(
        previewMaintenanceSchema.safeParse({ ...value, ...extra }).success,
      ).toBe(false);
    expect(
      previewMaintenanceSchema.safeParse({
        ...value,
        start: { kind: "now", at: value.end },
      }).success,
    ).toBe(false);
    expect(
      previewMaintenanceSchema.safeParse({ ...value, start: { kind: "bad" } })
        .success,
    ).toBe(false);
    expect(
      previewMaintenanceSchema.safeParse({
        ...value,
        start: { kind: "at", at: "2026-10-07T12:30" },
      }).success,
    ).toBe(false);
  });
  it("requires a reason and exact unique expected-booking array for mutations", () => {
    const value = {
      ...input(),
      reason: "  장비 점검  ",
      expectedBookingIds: [crypto.randomUUID()],
    };
    expect(createMaintenanceSchema.parse(value).reason).toBe("장비 점검");
    expect(
      createMaintenanceSchema.parse({ ...value, expectedBookingIds: [] })
        .expectedBookingIds,
    ).toEqual([]);
    expect(
      createMaintenanceSchema.safeParse({
        ...value,
        expectedBookingIds: [
          value.expectedBookingIds[0]!,
          value.expectedBookingIds[0]!.toUpperCase(),
        ],
      }).success,
    ).toBe(false);
    expect(
      createMaintenanceSchema.safeParse({
        ...value,
        expectedBookingIds: undefined,
      }).success,
    ).toBe(false);
    expect(
      createMaintenanceSchema.safeParse({
        ...value,
        actorId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
    const { spaceId: blockId, ...fields } = value;
    expect(updateMaintenanceSchema.parse({ blockId, ...fields }).blockId).toBe(
      blockId,
    );
    expect(
      updateMaintenanceSchema.safeParse({
        blockId,
        ...fields,
        spaceId: crypto.randomUUID(),
      }).success,
    ).toBe(false);
    expect(blockIdSchema.parse({ blockId: blockId.toUpperCase() })).toEqual({
      blockId,
    });
    expect(blockIdSchema.safeParse({ blockId, start: "now" }).success).toBe(
      false,
    );
  });
  it.each(["", "  \n ", "가".repeat(101), "😀".repeat(101), "점검\0이유"])(
    "rejects an invalid reason without truncating it (%s)",
    (reason) => {
      expect(
        createMaintenanceSchema.safeParse({
          ...input(),
          reason,
          expectedBookingIds: [],
        }).success,
      ).toBe(false);
    },
  );
  it("counts Unicode code points and accepts exactly one hundred emoji", () => {
    const reason = "😀".repeat(100);
    expect(
      createMaintenanceSchema.parse({
        ...input(),
        reason,
        expectedBookingIds: [],
      }).reason,
    ).toBe(reason);
  });
  it("strictly validates list tab and identifiers at runtime", () => {
    const branchId = crypto.randomUUID();
    expect(
      maintenanceListSchema.parse({ branchId: branchId.toUpperCase() }),
    ).toEqual({ branchId, tab: "active" });
    expect(maintenanceListSchema.parse({ branchId, tab: "past" }).tab).toBe(
      "past",
    );
    for (const value of [
      { branchId: "bad" },
      { branchId, tab: "all" },
      { branchId, floorId: crypto.randomUUID() },
    ])
      expect(maintenanceListSchema.safeParse(value).success).toBe(false);
  });
});

describe("maintenance local-time window", () => {
  it("floors now to its minute without changing the injected clock or requiring a thirty-minute start", () => {
    const result = window({ kind: "now" });
    expect(result.start.toISOString()).toBe("2026-10-07T03:10:00.000Z");
    expect(result.end.toISOString()).toBe("2026-10-07T04:30:00.000Z");
    expect(now.toISOString()).toBe("2026-10-07T03:10:42.345Z");
  });
  it("allows an explicit start exactly at now and rejects an earlier explicit start", () => {
    expect(
      window(
        at("2026-10-07T12:00:00+09:00"),
        "2026-10-07T12:30:00+09:00",
        "Asia/Seoul",
        new Date("2026-10-07T03:00:00Z"),
      ).start.toISOString(),
    ).toBe("2026-10-07T03:00:00.000Z");
    invalid(() => window(at("2026-10-07T12:00:00+09:00")), "start");
  });
  it.each([
    "2026-10-07T12:31:00+09:00",
    "2026-10-07T12:30:01+09:00",
    "2026-10-07T12:30:00.001+09:00",
    "2026-10-07T12:30:00.000001+09:00",
    "2026-10-07T12:30",
    "bad",
  ])("rejects an unaligned or ambiguous start %s", (start) =>
    invalid(() => window(at(start)), "start"),
  );
  it.each([
    "2026-10-07T13:31:00+09:00",
    "2026-10-07T13:30:01+09:00",
    "2026-10-07T13:30:00.000001+09:00",
    "2026-10-07T12:30:00+09:00",
    "2026-10-07T12:00:00+09:00",
    "bad",
  ])("rejects an unaligned or non-positive end %s", (end) =>
    invalid(() => window(at(), end), "end"),
  );
  it("checks alignment in the branch timezone, including non-hour offsets", () => {
    const current = new Date("2026-10-07T00:00:00Z");
    expect(
      window(
        at("2026-10-07T03:15:00Z"),
        "2026-10-07T03:45:00Z",
        "Asia/Kathmandu",
        current,
      ).start.toISOString(),
    ).toBe("2026-10-07T03:15:00.000Z");
    invalid(
      () =>
        window(
          at("2026-10-07T03:00:00Z"),
          "2026-10-07T03:45:00Z",
          "Asia/Kathmandu",
          current,
        ),
      "start",
    );
  });
  it("accepts windows outside opening hours and spanning local dates", () => {
    expect(
      window(
        at("2026-10-07T23:30:00+09:00"),
        "2026-10-08T01:00:00+09:00",
      ).end.toISOString(),
    ).toBe("2026-10-07T16:00:00.000Z");
  });
  it("accepts exactly thirty local calendar days and rejects one more slot", () => {
    expect(window(at(), "2026-11-06T12:30:00+09:00").end.toISOString()).toBe(
      "2026-11-06T03:30:00.000Z",
    );
    invalid(() => window(at(), "2026-11-06T13:00:00+09:00"), "end");
  });
  it.each([
    [
      "2026-02-10T10:00:00-08:00",
      "2026-03-12T10:00:00-07:00",
      "2026-03-12T10:30:00-07:00",
      719,
    ],
    [
      "2026-10-10T10:00:00-07:00",
      "2026-11-09T10:00:00-08:00",
      "2026-11-09T10:30:00-08:00",
      721,
    ],
  ] as const)(
    "uses calendar days instead of 720 hours across %s DST",
    (start, end, outside, hours) => {
      const current = new Date("2026-01-01T00:00:00Z");
      const result = window(at(start), end, "America/Los_Angeles", current);
      expect((result.end.getTime() - result.start.getTime()) / 3_600_000).toBe(
        hours,
      );
      invalid(
        () => window(at(start), outside, "America/Los_Angeles", current),
        "end",
      );
    },
  );
  it("uses the established first-valid-time boundary if day thirty is in a DST gap", () => {
    const current = new Date("2026-02-01T00:00:00Z");
    expect(
      window(
        at("2026-02-06T02:30:00-08:00"),
        "2026-03-08T03:00:00-07:00",
        "America/Los_Angeles",
        current,
      ).end.toISOString(),
    ).toBe("2026-03-08T10:00:00.000Z");
    invalid(
      () =>
        window(
          at("2026-02-06T02:30:00-08:00"),
          "2026-03-08T03:30:00-07:00",
          "America/Los_Angeles",
          current,
        ),
      "end",
    );
  });
  it("does not move the second repeated hour backwards when flooring now", () => {
    const current = new Date("2026-11-01T09:10:59Z");
    expect(
      window(
        { kind: "now" },
        "2026-11-01T10:00:00Z",
        "America/Los_Angeles",
        current,
      ).start.toISOString(),
    ).toBe("2026-11-01T09:10:00.000Z");
  });
  it("rejects invalid timezone/clock and unsupported far-future boundaries with field errors", () => {
    invalid(() => window(at(), undefined, "not-a-zone"), "start");
    invalid(
      () => window(at(), undefined, "Asia/Seoul", new Date("bad")),
      "start",
    );
    invalid(
      () => window(at("9999-12-31T00:00:00Z"), "9999-12-31T00:30:00Z", "UTC"),
      "end",
    );
  });
});

describe("maintenance space guard", () => {
  const floorId = crypto.randomUUID();
  const parent = {
    id: crypto.randomUUID(),
    floorId,
    type: "desk_area" as const,
    archivedAt: null,
  };
  const row = {
    space: {
      floorId,
      parentId: parent.id,
      type: "desk" as const,
      archivedAt: null,
    },
    parent,
  };
  it("accepts seats, non-bookable areas and closed-access rooms", () => {
    expect(ensureMaintenanceSpace(row)).toBe(row);
    expect(
      ensureMaintenanceSpace({
        space: {
          floorId,
          parentId: null,
          type: "desk_area",
          archivedAt: null,
          bookable: false,
        },
        parent: null,
      }).space.type,
    ).toBe("desk_area");
  });
  it("rejects lounge, archived, missing and mismatched parent rows", () => {
    for (const value of [
      null,
      { ...row, parent: null },
      { ...row, parent: { ...parent, archivedAt: now } },
      { ...row, parent: { ...parent, floorId: crypto.randomUUID() } },
      { ...row, parent: { ...parent, type: "meeting_room" as const } },
      { ...row, space: { ...row.space, type: "lounge" as const } },
      { ...row, space: { ...row.space, archivedAt: now } },
    ])
      expect(() => ensureMaintenanceSpace(value)).toThrowError("NOT_FOUND");
  });
});
