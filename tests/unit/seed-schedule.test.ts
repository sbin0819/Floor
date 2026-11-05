import { describe, expect, it } from "vitest";
import scheduleFile from "@/docs/spec/examples/seed-schedule.json";
import { defaultLimits } from "@/lib/permissions/defaults";
import { loadSeedData } from "@/lib/seed/data";
import { SeedError } from "@/lib/seed/errors";
import {
  expandSeedSchedule,
  loadSeedSchedule,
  parseSeedSchedule,
  seedScheduleId,
  type ExpandedBooking,
} from "@/lib/seed/schedule";
import { getOpenHours } from "@/lib/time/open-hours";
import { localDate, localTime } from "@/lib/time/zoned";

const data = loadSeedData();
const schedule = loadSeedSchedule(data);
// 목요일 14:00 KST
const now = new Date("2026-11-05T05:00:00Z");
const expanded = expandSeedSchedule(schedule, data, now);
const spaces = new Map(data.spaces.map((row) => [row.id, row]));
const floors = new Map(data.floors.map((row) => [row.id, row]));
const branches = new Map(data.branches.map((row) => [row.id, row]));
const operators = new Set(
  data.branchStaff.map(({ branchId, userKey }) => `${branchId}:${userKey}`),
);
const DAY = 86_400_000;
type Range = { start: number; end: number };
const overlaps = (a: Range, b: Range) => a.start < b.end && b.start < a.end;
const rangeOf = (row: { during: { start: Date; end: Date } }) => ({
  start: row.during.start.getTime(),
  end: row.during.end.getTime(),
});
const minutes = (booking: ExpandedBooking) =>
  (booking.during.end.getTime() - booking.during.start.getTime()) / 60_000;

function file() {
  return structuredClone(scheduleFile);
}

describe("month-long seed schedule", () => {
  it("covers the window on both sides of today with realistic volume", () => {
    const branch = branches.get(expanded.bookings[0]!.branchId)!;
    const today = localDate(now, branch.timezone);
    const dates = new Set(expanded.bookings.map(({ date }) => date));
    expect(
      Math.min(...[...dates].map((date) => Date.parse(date))),
    ).toBeLessThan(Date.parse(today) - 25 * DAY);
    expect(
      Math.max(...[...dates].map((date) => Date.parse(date))),
    ).toBeGreaterThan(Date.parse(today) + 10 * DAY);
    expect(expanded.bookings.length).toBeGreaterThan(1000);
    expect(
      expanded.bookings.filter((row) => row.isDesk).length,
    ).toBeGreaterThan(200);
    expect(
      expanded.bookings.filter((row) => row.during.start >= now).length,
    ).toBeGreaterThan(150);
    expect(expanded.blocks).toHaveLength(schedule.maintenance.length);
    expect(expanded.announcements).toHaveLength(schedule.announcements.length);
    expect(
      new Set(expanded.bookings.map(({ branchId }) => branchId)).size,
    ).toBe(5);
  });

  it("never overlaps confirmed bookings in a space, a desk user, a person's meetings, or a maintenance block", () => {
    const confirmed = expanded.bookings.filter(
      (row) => row.status === "confirmed",
    );
    const bySpace = new Map<string, Range[]>();
    const deskByUser = new Map<string, Range[]>();
    const timeByUser = new Map<string, Range[]>();
    for (const booking of confirmed) {
      const range = rangeOf(booking);
      for (const other of bySpace.get(booking.spaceId) ?? [])
        expect(overlaps(range, other)).toBe(false);
      bySpace.set(booking.spaceId, [
        ...(bySpace.get(booking.spaceId) ?? []),
        range,
      ]);
      if (booking.isDesk) {
        for (const other of deskByUser.get(booking.userKey) ?? [])
          expect(overlaps(range, other)).toBe(false);
        deskByUser.set(booking.userKey, [
          ...(deskByUser.get(booking.userKey) ?? []),
          range,
        ]);
      } else {
        for (const other of timeByUser.get(booking.userKey) ?? [])
          expect(overlaps(range, other)).toBe(false);
        timeByUser.set(booking.userKey, [
          ...(timeByUser.get(booking.userKey) ?? []),
          range,
        ]);
      }
      const space = spaces.get(booking.spaceId)!;
      for (const block of expanded.blocks)
        if (
          block.spaceId === booking.spaceId ||
          block.spaceId === space.parentId
        )
          expect(overlaps(range, rangeOf(block))).toBe(false);
    }
  });

  it("keeps every booking inside its branch's operating hours and on the same local date", () => {
    for (const booking of expanded.bookings) {
      const branch = branches.get(booking.branchId)!;
      const hours = getOpenHours(branch.openHours, booking.date);
      expect(hours).not.toBeNull();
      expect(localDate(booking.during.start, branch.timezone)).toBe(
        booking.date,
      );
      expect(
        localTime(booking.during.start, branch.timezone) >= hours!.open,
      ).toBe(true);
      const end =
        localDate(booking.during.end, branch.timezone) === booking.date
          ? localTime(booking.during.end, branch.timezone)
          : "24:00";
      expect(end <= hours!.close || end === "24:00").toBe(true);
      expect(booking.floorId).toBe(spaces.get(booking.spaceId)!.floorId);
      expect(floors.get(booking.floorId)!.branchId).toBe(booking.branchId);
      expect(booking.createdAt < now).toBe(true);
      expect(booking.createdAt <= booking.during.start).toBe(true);
    }
  });

  it("respects the role limits for everyone except operators", () => {
    const personal = new Map<string, number>();
    const team = new Map<string, number>();
    for (const booking of expanded.bookings) {
      if (booking.status !== "confirmed" || booking.isDesk) continue;
      if (operators.has(`${booking.branchId}:${booking.userKey}`)) continue;
      const limits = booking.teamId
        ? defaultLimits.team_member
        : defaultLimits.user;
      expect(minutes(booking)).toBeLessThanOrEqual(limits.maxMinutesPerBooking);
      const key = booking.teamId
        ? `${booking.teamId}:${booking.branchId}:${booking.date}`
        : `${booking.userKey}:${booking.branchId}:${booking.date}`;
      const map = booking.teamId ? team : personal;
      map.set(key, (map.get(key) ?? 0) + minutes(booking));
      const branch = branches.get(booking.branchId)!;
      const daysAhead = Math.round(
        (Date.parse(booking.date) -
          Date.parse(localDate(booking.createdAt, branch.timezone))) /
          DAY,
      );
      expect(daysAhead).toBeLessThanOrEqual(limits.maxDaysAhead);
    }
    for (const total of personal.values())
      expect(total).toBeLessThanOrEqual(defaultLimits.user.maxMinutesPerDay);
    for (const total of team.values())
      expect(total).toBeLessThanOrEqual(
        defaultLimits.team_member.maxMinutesPerDay,
      );
  });

  it("turns bookings made before a later maintenance into maintenance cancellations with the block's reason", () => {
    const cancelled = expanded.bookings.filter(
      (row) => row.cancelKind === "maintenance",
    );
    expect(cancelled.length).toBeGreaterThan(0);
    for (const booking of cancelled) {
      const space = spaces.get(booking.spaceId)!;
      const block = expanded.blocks.find(
        (row) =>
          (row.spaceId === booking.spaceId || row.spaceId === space.parentId) &&
          overlaps(rangeOf(row), rangeOf(booking)),
      )!;
      expect(block).toBeDefined();
      expect(booking).toMatchObject({
        status: "cancelled",
        cancelledByKey: block.createdByKey,
        cancelReason: block.reason ?? "점검",
      });
      expect(booking.createdAt <= block.createdAt).toBe(true);
      expect(booking.cancelledAt!.getTime()).toBeGreaterThanOrEqual(
        block.createdAt.getTime(),
      );
      expect(booking.cancelledAt! <= now).toBe(true);
    }
    const operatorCancelled = expanded.bookings.find(
      (row) => row.key === "operator-cancelled-h2b",
    )!;
    expect(operatorCancelled).toMatchObject({
      status: "cancelled",
      cancelKind: "operator",
      cancelReason: "중복 예약 정리 요청",
      cancelledByKey: "admin",
    });
    for (const booking of expanded.bookings.filter(
      (row) => row.status === "cancelled",
    ))
      expect(booking.cancelledAt!.getTime()).toBeGreaterThan(
        booking.createdAt.getTime(),
      );
  });

  it("uses stable ids that re-running on another day deletes and re-creates", () => {
    expect(new Set(expanded.bookingIds).size).toBe(expanded.bookingIds.length);
    const ids = new Set(expanded.bookingIds);
    for (const booking of expanded.bookings)
      expect(ids.has(booking.id)).toBe(true);
    const later = expandSeedSchedule(
      schedule,
      data,
      new Date(now.getTime() + 3 * DAY),
    );
    expect(later.bookingIds).toEqual(expanded.bookingIds);
    expect(later.blockIds).toEqual(expanded.blockIds);
    expect(later.announcementIds).toEqual(expanded.announcementIds);
    const weekly = expanded.bookings.filter(
      (row) => row.key === "design-weekly",
    );
    expect(weekly.length).toBeGreaterThanOrEqual(5);
    expect(
      weekly.every(
        (row) => localDate(row.during.start, "Asia/Seoul") === row.date,
      ),
    ).toBe(true);
    expect(seedScheduleId("recurring:design-weekly:0")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u,
    );
    // 같은 날 다시 펼치면 완전히 같은 결과다.
    expect(expandSeedSchedule(schedule, data, now)).toEqual(expanded);
  });

  it("attaches meeting messages only in the past and to members of that booking", () => {
    const withMessages = expanded.bookings.filter((row) => row.messages.length);
    expect(withMessages.length).toBeGreaterThanOrEqual(4);
    for (const booking of withMessages) {
      const members = new Set([booking.userKey, ...booking.participantKeys]);
      let previous = booking.createdAt.getTime();
      for (const message of booking.messages) {
        expect(members.has(message.authorKey)).toBe(true);
        expect(message.at <= now).toBe(true);
        expect(message.at.getTime()).toBeGreaterThan(previous);
        previous = message.at.getTime();
      }
    }
    // 목요일 오후: 가장 가까운 지난 월요일 위클리에는 previous 메시지가, 다음 위클리의 하루 전 메시지는 아직 미래라 없다.
    const weekly = expanded.bookings.filter(
      (row) => row.key === "design-weekly",
    );
    const previousWeekly = [...weekly]
      .reverse()
      .find((row) => row.during.start < now)!;
    const nextWeekly = weekly.find((row) => row.during.start >= now)!;
    const pattern = schedule.recurring.find(
      (row) => row.key === "design-weekly",
    )!;
    expect(previousWeekly.messages.map(({ body }) => body)).toEqual(
      pattern.messages!.previous!.map(({ body }) => body),
    );
    expect(nextWeekly.messages).toEqual([]);
    // 월요일 아침에 돌리면 다음 위클리(그날 10시)의 전날 메시지가 붙는다.
    const monday = expandSeedSchedule(
      schedule,
      data,
      new Date("2026-11-09T00:00:00Z"),
    );
    const upcoming = monday.bookings.find(
      (row) =>
        row.key === "design-weekly" &&
        row.during.start >= new Date("2026-11-09T00:00:00Z"),
    )!;
    expect(upcoming.messages.map(({ body }) => body)).toEqual(
      pattern.messages!.next!.map(({ body }) => body),
    );
  });

  it("derives announcement recipients from bookings that existed when the notice went out", () => {
    const orientation = expanded.announcements.find(
      (row) => row.key === "gangnam-orientation",
    )!;
    expect(orientation.recipientKeys.length).toBeGreaterThan(0);
    expect(orientation.recipientKeys).not.toContain("admin");
    const audienceDate = orientation.audience!.date;
    for (const key of orientation.recipientKeys)
      expect(
        expanded.bookings.some(
          (booking) =>
            booking.branchId === orientation.branchId &&
            booking.date === audienceDate &&
            booking.createdAt <= orientation.at &&
            (booking.userKey === key || booking.participantKeys.includes(key)),
        ),
      ).toBe(true);
    for (const announcement of expanded.announcements) {
      expect(announcement.at <= now).toBe(true);
      expect(announcement.recipientKeys).toEqual(
        [...announcement.recipientKeys].sort(),
      );
    }
  });

  it.each([
    [
      "unknown space",
      (input: ReturnType<typeof file>) => {
        input.oneOff[0]!.spaceId = "00000000-0000-4000-8000-000000000001";
      },
      "없는 공간",
    ],
    [
      "participant over capacity",
      (input: ReturnType<typeof file>) => {
        input.oneOff.find(
          (row) => row.key === "haeun-one-on-one",
        )!.participantKeys = [
          "designMember",
          "both",
          "test13",
          "test14",
          "test15",
          "test16",
          "test17",
          "test18",
        ];
      },
      "정원",
    ],
    [
      "team booking by a non-member",
      (input: ReturnType<typeof file>) => {
        input.recurring.find((row) => row.key === "design-weekly")!.userKey =
          "test6";
      },
      "팀원이 아니에요",
    ],
    [
      "personal booking in a team-only room",
      (input: ReturnType<typeof file>) => {
        input.recurring.find((row) => row.key === "growth-standup")!.teamId =
          null;
      },
      "팀 이름으로만",
    ],
    [
      "duplicate pattern key",
      (input: ReturnType<typeof file>) => {
        input.oneOff[1]!.key = input.oneOff[0]!.key;
      },
      "패턴 키",
    ],
    [
      "maintenance by a non-operator",
      (input: ReturnType<typeof file>) => {
        input.maintenance[0]!.createdByKey = "member";
      },
      "운영자만",
    ],
    [
      "announcement with a mention",
      (input: ReturnType<typeof file>) => {
        input.announcements[0]!.body = "<@everyone> 모두 보세요";
      },
      "멘션",
    ],
    [
      "unaligned clock",
      (input: ReturnType<typeof file>) => {
        input.oneOff[0]!.start = "10:15";
      },
      "30분",
    ],
  ])("rejects %s before touching the database", (_name, change, message) => {
    const input = file();
    change(input);
    expect(() => parseSeedSchedule(input, data)).toThrow(SeedError);
    expect(() => parseSeedSchedule(input, data)).toThrow(message);
  });

  it("fails loudly when an explicit one-off collides with another explicit booking", () => {
    const input = file();
    const first = input.oneOff.find((row) => row.key === "networking-prep")!;
    input.oneOff.push({
      ...structuredClone(first),
      key: "collides-with-networking",
      userKey: "admin",
    });
    expect(() =>
      expandSeedSchedule(parseSeedSchedule(input, data), data, now),
    ).toThrow("겹쳐요");
  });
});
