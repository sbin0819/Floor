import { createHash } from "node:crypto";
import { z } from "zod";
import scheduleFile from "@/docs/spec/examples/seed-schedule.json";
import { createDeskParts, type DeskPart } from "@/features/bookings/desk-parts";
import { messageBodySchema } from "@/features/chat/schema";
import { defaultLimits } from "@/lib/permissions/defaults";
import { getOpenHours, getOperatingDate } from "@/lib/time/open-hours";
import {
  addDays,
  dayKeys,
  localDate,
  localTime,
  SLOT_MINUTES,
  timeToMinutes,
  weekday,
  zonedDateTime,
} from "@/lib/time/zoned";
import type { SeedData } from "./data";
import { SeedError } from "./errors";

// ---------- 스키마 ----------

const uuid = z.uuid().transform((value) => value.toLowerCase());
const patternKey = z.string().regex(/^[a-z0-9][a-z0-9-]{1,60}$/u);
const userKey = z.string().min(1);
function clockMinutes(value: string): number {
  try {
    return timeToMinutes(value);
  } catch {
    return Number.NaN;
  }
}
const clock = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u, "시각은 HH:mm 형식이어야 해요.")
  .refine(
    (value) => clockMinutes(value) % SLOT_MINUTES === 0,
    "시각은 30분 단위여야 해요.",
  );
const endClock = z.union([clock, z.literal("24:00")]);
const announcementClock = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/u, "시각은 HH:mm 형식이어야 해요.");
const title = z
  .string()
  .trim()
  .refine((value) => {
    const length = Array.from(value).length;
    return length >= 1 && length <= 60;
  }, "제목은 1–60자여야 해요.");
const attendeeCount = z.int().min(1).max(500).nullable().default(null);
const participantKeys = z.array(userKey).max(20).default([]);
const messageSchema = z.strictObject({
  authorKey: userKey,
  minutesFromStart: z.int().min(-20_160).max(1_440),
  body: messageBodySchema,
});
const messages = z
  .array(messageSchema)
  .max(20)
  .refine(
    (rows) =>
      rows.every(
        (row, index) =>
          index === 0 ||
          row.minutesFromStart > rows[index - 1]!.minutesFromStart,
      ),
    "메시지는 오래된 것부터 차례로 적어요.",
  );
const bookingFields = {
  key: patternKey,
  spaceId: uuid,
  start: clock,
  end: endClock,
  userKey,
  teamId: uuid.nullable().default(null),
  title: title.nullable().default(null),
  attendeeCount,
  participantKeys,
};
const timeOrder = (row: { start: string; end: string }) =>
  clockMinutes(row.start) < clockMinutes(row.end);
const weekdays = z.array(z.enum(dayKeys)).min(1).max(7);

const scheduleSchema = z.strictObject({
  note: z.string(),
  window: z.strictObject({
    pastDays: z.int().min(0).max(90),
    futureDays: z.int().min(0).max(90),
  }),
  recurring: z.array(
    z
      .strictObject({
        ...bookingFields,
        weekdays,
        createdDaysBefore: z.int().min(0).max(60).default(7),
        messages: z
          .strictObject({
            previous: messages.optional(),
            next: messages.optional(),
          })
          .optional(),
      })
      .refine(timeOrder, {
        path: ["end"],
        message: "끝은 시작보다 뒤여야 해요.",
      }),
  ),
  oneOff: z.array(
    z
      .strictObject({
        ...bookingFields,
        dayOffset: z.int().min(-90).max(90),
        createdDaysBefore: z.int().min(0).max(60).default(3),
        status: z.enum(["confirmed", "cancelled"]).default("confirmed"),
        cancelledByKey: userKey.nullable().default(null),
        cancelKind: z
          .enum(["operator", "maintenance"])
          .nullable()
          .default(null),
        cancelReason: z
          .string()
          .refine((value) => {
            const length = Array.from(value).length;
            return length >= 1 && length <= 200;
          })
          .nullable()
          .default(null),
        messages: messages.optional(),
      })
      .refine(timeOrder, {
        path: ["end"],
        message: "끝은 시작보다 뒤여야 해요.",
      })
      .refine(
        (row) => (row.status === "cancelled") === (row.cancelledByKey !== null),
        {
          path: ["cancelledByKey"],
          message: "취소된 예약에만 취소한 사람을 적어요.",
        },
      )
      .refine(
        (row) => (row.cancelKind === null) === (row.cancelReason === null),
        {
          path: ["cancelReason"],
          message: "취소 종류와 이유는 함께 적어요.",
        },
      )
      .refine((row) => row.cancelKind === null || row.status === "cancelled", {
        path: ["cancelKind"],
        message: "취소 종류는 취소된 예약에만 있어요.",
      })
      .refine((row) => row.cancelKind !== "maintenance", {
        path: ["cancelKind"],
        message: "점검 취소는 maintenance와 겹치는 예약에서 자동으로 만들어요.",
      }),
  ),
  deskRegulars: z.array(
    z.strictObject({
      key: patternKey,
      deskId: uuid,
      weekdays,
      part: z.enum(["am", "pm", "day"]),
      userKey,
      createdDaysBefore: z.int().min(0).max(60).default(5),
    }),
  ),
  fill: z.array(
    z
      .strictObject({
        key: patternKey,
        spaceIds: z.array(uuid).min(1).max(30),
        userKeys: z.array(userKey).min(1).max(30),
        teamId: uuid.nullable().default(null),
        perDay: z.tuple([z.int().min(0).max(8), z.int().min(0).max(8)]),
        durations: z.array(z.int().positive().multipleOf(SLOT_MINUTES)).min(1),
        hours: z.tuple([clock, endClock]).optional(),
        titles: z.array(title).default([]),
        untitledRate: z.number().min(0).max(1).default(0.3),
        cancelRate: z.number().min(0).max(1).default(0.08),
        weekendFactor: z.number().min(0).max(1).default(0.3),
        futureDecay: z.number().min(0).max(1).default(0.6),
      })
      .refine((row) => row.perDay[0] <= row.perDay[1], {
        path: ["perDay"],
        message: "하루 최소는 최대보다 클 수 없어요.",
      }),
  ),
  deskFill: z.array(
    z
      .strictObject({
        key: patternKey,
        areaId: uuid,
        userKeys: z.array(userKey).min(1).max(30),
        perDay: z.tuple([z.int().min(0).max(24), z.int().min(0).max(24)]),
        parts: z
          .array(z.enum(["am", "pm", "day"]))
          .min(1)
          .default(["am", "pm", "day"]),
        cancelRate: z.number().min(0).max(1).default(0.05),
        weekendFactor: z.number().min(0).max(1).default(0.2),
        futureDecay: z.number().min(0).max(1).default(0.6),
      })
      .refine((row) => row.perDay[0] <= row.perDay[1], {
        path: ["perDay"],
        message: "하루 최소는 최대보다 클 수 없어요.",
      }),
  ),
  maintenance: z.array(
    z
      .strictObject({
        key: patternKey,
        spaceId: uuid,
        startDayOffset: z.int().min(-90).max(90),
        start: clock,
        endDayOffset: z.int().min(-90).max(90),
        end: endClock,
        reason: z
          .string()
          .trim()
          .refine((value) => Array.from(value).length <= 200)
          .nullable(),
        createdByKey: userKey,
      })
      .refine(
        (row) =>
          row.endDayOffset * 1_440 + clockMinutes(row.end) >
          row.startDayOffset * 1_440 + clockMinutes(row.start),
        { path: ["end"], message: "점검의 끝은 시작보다 뒤여야 해요." },
      ),
  ),
  announcements: z.array(
    z.strictObject({
      key: patternKey,
      branchId: uuid,
      authorKey: userKey,
      daysAgo: z.int().min(0).max(90),
      time: announcementClock,
      title,
      body: z
        .string()
        .trim()
        .refine((value) => {
          const length = Array.from(value).length;
          return length >= 1 && length <= 500;
        }),
      audience: z
        .strictObject({
          dayOffset: z.int().min(-90).max(90),
          floorId: uuid.nullable(),
          spaceId: uuid.nullable(),
        })
        .nullable(),
    }),
  ),
});

export type SeedSchedule = z.infer<typeof scheduleSchema>;

// ---------- 참조 검증 ----------

type Lookup = {
  users: Set<string>;
  spaces: Map<string, SeedData["spaces"][number]>;
  floors: Map<string, SeedData["floors"][number]>;
  branches: Map<string, SeedData["branches"][number]>;
  teams: Set<string>;
  teamMembers: Set<string>;
  operators: Set<string>;
  grants: Map<string, Set<string>>;
};

function buildLookup(data: SeedData): Lookup {
  const grants = new Map<string, Set<string>>();
  for (const grant of data.accessGrants) {
    const key = `${grant.targetType}:${grant.targetId}`;
    const set = grants.get(key) ?? new Set<string>();
    set.add(grant.teamId);
    grants.set(key, set);
  }
  return {
    users: new Set(data.users.map(({ key }) => key)),
    spaces: new Map(data.spaces.map((row) => [row.id, row])),
    floors: new Map(data.floors.map((row) => [row.id, row])),
    branches: new Map(data.branches.map((row) => [row.id, row])),
    teams: new Set(data.teams.map(({ id }) => id)),
    teamMembers: new Set(
      data.teamMembers.map(({ teamId, userKey }) => `${teamId}:${userKey}`),
    ),
    operators: new Set(
      data.branchStaff.map(({ branchId, userKey }) => `${branchId}:${userKey}`),
    ),
    grants,
  };
}

function locate(lookup: Lookup, spaceId: string) {
  const space = lookup.spaces.get(spaceId);
  const floor = space ? lookup.floors.get(space.floorId) : undefined;
  const branch = floor ? lookup.branches.get(floor.branchId) : undefined;
  if (!space || !floor || !branch) return null;
  return { space, floor, branch };
}

/** 예약하는 방식이 그 공간의 접근 규칙에 맞는지 본다. */
function bookingAccessIssue(
  lookup: Lookup,
  spaceId: string,
  userKey: string,
  teamId: string | null,
): string | null {
  const located = locate(lookup, spaceId);
  if (!located) return "시드에 없는 공간이에요.";
  const { space, floor, branch } = located;
  const bookable =
    space.type === "desk"
      ? ((space.parentId &&
          lookup.spaces.get(space.parentId)?.type === "desk_area") ??
        false)
      : space.bookable;
  if (!bookable) return "예약할 수 없는 공간이에요.";
  if (!lookup.users.has(userKey)) return "시드에 없는 사용자예요.";
  if (teamId !== null) {
    if (!lookup.teams.has(teamId)) return "시드에 없는 팀이에요.";
    if (!lookup.teamMembers.has(`${teamId}:${userKey}`))
      return "예약한 사람이 그 팀의 팀원이 아니에요.";
  }
  const operator = lookup.operators.has(`${branch.id}:${userKey}`);
  const target =
    space.type === "desk" && space.parentId
      ? lookup.spaces.get(space.parentId)!
      : space;
  const scope = target.access ?? floor.access;
  if (scope === "closed" && !operator)
    return "닫힌 층·공간은 예약할 수 없어요.";
  if (scope === "teams") {
    if (teamId === null)
      return operator ? null : "지정한 팀의 공간은 팀 이름으로만 예약해요.";
    const allowed =
      lookup.grants.get(`space:${target.id}`)?.has(teamId) ||
      (target.access === null &&
        lookup.grants.get(`floor:${floor.id}`)?.has(teamId));
    if (!allowed) return "허용되지 않은 팀의 예약이에요.";
  }
  return null;
}

export function parseSeedSchedule(
  input: unknown,
  data: SeedData,
): SeedSchedule {
  const lookup = buildLookup(data);
  const result = scheduleSchema
    .superRefine((schedule, context) => {
      const issue = (path: (string | number)[], message: string) =>
        context.addIssue({ code: "custom", path, message });
      const keys = new Set<string>();
      const uniqueKey = (key: string, path: (string | number)[]) => {
        if (keys.has(key)) issue(path, "패턴 키가 겹쳐요.");
        keys.add(key);
      };
      const checkBooking = (
        row: {
          spaceId: string;
          userKey: string;
          teamId: string | null;
          attendeeCount: number | null;
          participantKeys: string[];
        },
        path: (string | number)[],
      ) => {
        const access = bookingAccessIssue(
          lookup,
          row.spaceId,
          row.userKey,
          row.teamId,
        );
        if (access) issue([...path, "spaceId"], access);
        const space = lookup.spaces.get(row.spaceId);
        if (space?.type === "desk") {
          if (row.attendeeCount !== null || row.participantKeys.length)
            issue(
              [...path, "attendeeCount"],
              "좌석 예약에는 인원과 참석자가 없어요.",
            );
          return;
        }
        if (new Set(row.participantKeys).size !== row.participantKeys.length)
          issue([...path, "participantKeys"], "같은 참석자가 두 번 있어요.");
        if (row.participantKeys.includes(row.userKey))
          issue(
            [...path, "participantKeys"],
            "예약한 사람은 참석자에 넣을 수 없어요.",
          );
        if (row.participantKeys.some((key) => !lookup.users.has(key)))
          issue([...path, "participantKeys"], "시드에 없는 참석자예요.");
        const capacity = space?.capacity ?? null;
        if (
          capacity !== null &&
          row.attendeeCount !== null &&
          row.attendeeCount > capacity
        )
          issue(
            [...path, "attendeeCount"],
            "사용 인원이 공간의 정원보다 많아요.",
          );
        if (capacity !== null && row.participantKeys.length + 1 > capacity)
          issue(
            [...path, "participantKeys"],
            "예약한 사람과 참석자가 정원보다 많아요.",
          );
        if (
          row.attendeeCount !== null &&
          row.participantKeys.length + 1 > row.attendeeCount
        )
          issue(
            [...path, "participantKeys"],
            "예약한 사람과 참석자가 사용 인원보다 많아요.",
          );
      };
      const checkMessages = (
        rows: readonly { authorKey: string }[] | undefined,
        members: readonly string[],
        path: (string | number)[],
      ) => {
        rows?.forEach((row, index) => {
          if (!members.includes(row.authorKey))
            issue(
              [...path, index, "authorKey"],
              "작성자가 이 예약의 멤버가 아니에요.",
            );
        });
      };
      schedule.recurring.forEach((row, index) => {
        const path = ["recurring", index];
        uniqueKey(row.key, [...path, "key"]);
        checkBooking(row, path);
        const members = [row.userKey, ...row.participantKeys];
        checkMessages(row.messages?.previous, members, [
          ...path,
          "messages",
          "previous",
        ]);
        checkMessages(row.messages?.next, members, [
          ...path,
          "messages",
          "next",
        ]);
      });
      schedule.oneOff.forEach((row, index) => {
        const path = ["oneOff", index];
        uniqueKey(row.key, [...path, "key"]);
        checkBooking(row, path);
        checkMessages(
          row.messages,
          [row.userKey, ...row.participantKeys],
          [...path, "messages"],
        );
        if (
          row.cancelledByKey !== null &&
          !lookup.users.has(row.cancelledByKey)
        )
          issue([...path, "cancelledByKey"], "시드에 없는 사용자예요.");
        const located = locate(lookup, row.spaceId);
        if (
          row.cancelKind === "operator" &&
          located &&
          row.cancelledByKey !== null &&
          !lookup.operators.has(`${located.branch.id}:${row.cancelledByKey}`)
        )
          issue(
            [...path, "cancelledByKey"],
            "운영자 취소는 그 지점 운영자만 할 수 있어요.",
          );
      });
      schedule.deskRegulars.forEach((row, index) => {
        const path = ["deskRegulars", index];
        uniqueKey(row.key, [...path, "key"]);
        if (lookup.spaces.get(row.deskId)?.type !== "desk")
          issue([...path, "deskId"], "좌석이 아니에요.");
        checkBooking(
          {
            spaceId: row.deskId,
            userKey: row.userKey,
            teamId: null,
            attendeeCount: null,
            participantKeys: [],
          },
          path,
        );
      });
      schedule.fill.forEach((row, index) => {
        const path = ["fill", index];
        uniqueKey(row.key, [...path, "key"]);
        if (new Set(row.spaceIds).size !== row.spaceIds.length)
          issue([...path, "spaceIds"], "같은 공간이 두 번 있어요.");
        if (new Set(row.userKeys).size !== row.userKeys.length)
          issue([...path, "userKeys"], "같은 사용자가 두 번 있어요.");
        for (const spaceId of row.spaceIds) {
          if (lookup.spaces.get(spaceId)?.type === "desk") {
            issue([...path, "spaceIds"], "좌석은 deskFill로 채워요.");
            continue;
          }
          for (const key of row.userKeys) {
            const access = bookingAccessIssue(lookup, spaceId, key, row.teamId);
            if (access) issue([...path, "spaceIds"], `${access} (${key})`);
          }
        }
        if (
          row.hours &&
          clockMinutes(row.hours[0]) >= clockMinutes(row.hours[1])
        )
          issue(
            [...path, "hours"],
            "채우는 시간대의 끝은 시작보다 뒤여야 해요.",
          );
      });
      schedule.deskFill.forEach((row, index) => {
        const path = ["deskFill", index];
        uniqueKey(row.key, [...path, "key"]);
        const area = lookup.spaces.get(row.areaId);
        if (area?.type !== "desk_area" || area.bookable)
          issue([...path, "areaId"], "좌석이 있는 데스크 구역이어야 해요.");
        if (new Set(row.userKeys).size !== row.userKeys.length)
          issue([...path, "userKeys"], "같은 사용자가 두 번 있어요.");
        if (row.userKeys.some((key) => !lookup.users.has(key)))
          issue([...path, "userKeys"], "시드에 없는 사용자예요.");
      });
      schedule.maintenance.forEach((row, index) => {
        const path = ["maintenance", index];
        uniqueKey(row.key, [...path, "key"]);
        const located = locate(lookup, row.spaceId);
        if (!located) issue([...path, "spaceId"], "시드에 없는 공간이에요.");
        else if (
          !lookup.operators.has(`${located.branch.id}:${row.createdByKey}`)
        )
          issue([...path, "createdByKey"], "점검은 그 지점 운영자만 등록해요.");
      });
      schedule.announcements.forEach((row, index) => {
        const path = ["announcements", index];
        uniqueKey(row.key, [...path, "key"]);
        if (!lookup.branches.has(row.branchId))
          issue([...path, "branchId"], "시드에 없는 지점이에요.");
        if (!lookup.operators.has(`${row.branchId}:${row.authorKey}`))
          issue([...path, "authorKey"], "공지는 그 지점 운영자만 보내요.");
        if (row.title.includes("<@") || row.body.includes("<@"))
          issue([...path, "body"], "공지에는 멘션을 넣을 수 없어요.");
        if (row.audience) {
          const floor = row.audience.floorId
            ? lookup.floors.get(row.audience.floorId)
            : null;
          if (row.audience.floorId && floor?.branchId !== row.branchId)
            issue([...path, "audience", "floorId"], "그 지점의 층이 아니에요.");
          if (row.audience.spaceId) {
            const space = lookup.spaces.get(row.audience.spaceId);
            if (
              !row.audience.floorId ||
              space?.floorId !== row.audience.floorId
            )
              issue(
                [...path, "audience", "spaceId"],
                "고른 층의 공간이어야 해요.",
              );
          }
        }
      });
    })
    .safeParse(input);
  if (!result.success)
    throw new SeedError(
      `일정 시드 데이터 검증 실패: ${result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")}`,
    );
  return result.data;
}

export function loadSeedSchedule(data: SeedData): SeedSchedule {
  return parseSeedSchedule(scheduleFile, data);
}

// ---------- 고정 id와 난수 ----------

const namespace = Buffer.from("floor:seed:schedule:v1");

export function seedScheduleId(name: string): string {
  const bytes = createHash("sha1")
    .update(namespace)
    .update(name)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function hash32(value: string): number {
  let hash = 0x811c9dc5;
  for (const byte of Buffer.from(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** 같은 이름이면 같은 수열을 내는 작은 난수 생성기다 (mulberry32). */
function createRandom(seed: string) {
  let state = hash32(seed) || 1;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  return {
    next,
    int: (min: number, max: number) =>
      min + Math.floor(next() * (max - min + 1)),
    pick: <T>(rows: readonly T[]): T => rows[Math.floor(next() * rows.length)]!,
    chance: (rate: number) => next() < rate,
  };
}

// ---------- 펼친 결과 ----------

export type ExpandedBookingSource =
  "recurring" | "oneOff" | "deskRegular" | "fill" | "deskFill";
export type ExpandedBooking = {
  id: string;
  key: string;
  source: ExpandedBookingSource;
  spaceId: string;
  floorId: string;
  branchId: string;
  isDesk: boolean;
  date: string;
  during: { start: Date; end: Date };
  userKey: string;
  teamId: string | null;
  title: string | null;
  attendeeCount: number | null;
  participantKeys: string[];
  createdAt: Date;
  status: "confirmed" | "cancelled";
  cancelledByKey: string | null;
  cancelledAt: Date | null;
  cancelKind: "operator" | "maintenance" | null;
  cancelReason: string | null;
  messages: { authorKey: string; at: Date; body: string }[];
};
export type ExpandedBlock = {
  id: string;
  key: string;
  spaceId: string;
  branchId: string;
  during: { start: Date; end: Date };
  reason: string | null;
  createdByKey: string;
  createdAt: Date;
};
export type ExpandedAnnouncement = {
  id: string;
  key: string;
  branchId: string;
  authorKey: string;
  at: Date;
  title: string;
  body: string;
  audience: {
    date: string;
    floorId: string | null;
    spaceId: string | null;
  } | null;
  recipientKeys: string[];
};
export type ExpandedSchedule = {
  window: { pastDays: number; futureDays: number };
  bookings: ExpandedBooking[];
  blocks: ExpandedBlock[];
  announcements: ExpandedAnnouncement[];
  /** 지금 펼쳐지지 않은 날의 id까지 포함한, 이 시드가 만들 수 있는 모든 예약 id. */
  bookingIds: string[];
  blockIds: string[];
  announcementIds: string[];
};

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type Occupancy = Map<string, Map<string, { start: number; end: number }[]>>;

function overlaps(
  a: { start: number; end: number },
  b: { start: number; end: number },
) {
  return a.start < b.end && b.start < a.end;
}

function minutesOf(instant: Date, timeZone: string, date: string) {
  const own = localDate(instant, timeZone);
  if (own === date) return timeToMinutes(localTime(instant, timeZone));
  return own < date ? 0 : 1_440;
}

export function expandSeedSchedule(
  schedule: SeedSchedule,
  data: SeedData,
  now: Date,
): ExpandedSchedule {
  if (!Number.isFinite(now.getTime()))
    throw new SeedError("시드 기준 시각이 올바르지 않아요.");
  const lookup = buildLookup(data);
  const { pastDays, futureDays } = schedule.window;
  const dayIndexes = Array.from(
    { length: pastDays + futureDays + 1 },
    (_, index) => index - pastDays,
  );
  const latestCreation = new Date(now.getTime() - MINUTE);
  const bookingIds: string[] = [];
  const blockIds: string[] = [];
  const bookings: ExpandedBooking[] = [];
  const occupancy: Occupancy = new Map();
  const deskUse = new Map<string, { start: number; end: number }[]>(); // `${userKey}:${date}`
  const timeUse = new Map<string, { start: number; end: number }[]>(); // `${userKey}:${date}` 시간 예약
  const personalMinutes = new Map<string, number>(); // `${userKey}:${branchId}:${date}`
  const teamMinutes = new Map<string, number>(); // `${teamId}:${branchId}:${date}`

  const located = (spaceId: string) => {
    const result = locate(lookup, spaceId);
    if (!result)
      throw new SeedError("일정 시드가 가리키는 공간을 찾을 수 없어요.");
    return result;
  };
  const dateOf = (branch: SeedData["branches"][number], dayIndex: number) =>
    addDays(localDate(now, branch.timezone), dayIndex);
  const instant = (
    branch: SeedData["branches"][number],
    date: string,
    time: string,
  ) => zonedDateTime(date, time, branch.timezone);

  // 1. 점검
  const blocks: ExpandedBlock[] = schedule.maintenance.map((row) => {
    const { branch } = located(row.spaceId);
    const startDate = getOperatingDate(
      now,
      branch.timezone,
      branch.openHours,
      row.startDayOffset,
    );
    const endDate = getOperatingDate(
      now,
      branch.timezone,
      branch.openHours,
      row.endDayOffset,
    );
    const during = {
      start: instant(branch, startDate, row.start),
      end: instant(branch, endDate, row.end),
    };
    if (during.end <= during.start)
      throw new SeedError(`점검 ${row.key}의 끝이 시작보다 앞이에요.`);
    const id = seedScheduleId(`block:${row.key}`);
    blockIds.push(id);
    return {
      id,
      key: row.key,
      spaceId: row.spaceId,
      branchId: branch.id,
      during,
      reason: row.reason,
      createdByKey: row.createdByKey,
      createdAt: new Date(
        Math.min(latestCreation.getTime(), during.start.getTime() - DAY),
      ),
    };
  });
  const blocksFor = (spaceId: string) => {
    const space = lookup.spaces.get(spaceId);
    return blocks.filter(
      (block) =>
        block.spaceId === spaceId ||
        (space?.parentId !== null && block.spaceId === space?.parentId),
    );
  };

  const occupied = (
    spaceId: string,
    date: string,
    range: { start: number; end: number },
  ) =>
    (occupancy.get(spaceId)?.get(date) ?? []).some((other) =>
      overlaps(other, range),
    );
  const occupy = (
    spaceId: string,
    date: string,
    range: { start: number; end: number },
  ) => {
    const byDate =
      occupancy.get(spaceId) ??
      new Map<string, { start: number; end: number }[]>();
    const rows = byDate.get(date) ?? [];
    rows.push(range);
    byDate.set(date, rows);
    occupancy.set(spaceId, byDate);
  };
  const deskBusy = (
    userKey: string,
    date: string,
    range: { start: number; end: number },
  ) =>
    (deskUse.get(`${userKey}:${date}`) ?? []).some((other) =>
      overlaps(other, range),
    );
  const occupyDesk = (
    userKey: string,
    date: string,
    range: { start: number; end: number },
  ) => {
    const key = `${userKey}:${date}`;
    deskUse.set(key, [...(deskUse.get(key) ?? []), range]);
  };
  // 한 사람이 같은 시각에 두 회의실에 있을 수는 없다. 좌석은 회의와 겹쳐도 된다 (자리를 잡아 두고 회의에 간다).
  const timeBusy = (
    userKey: string,
    date: string,
    range: { start: number; end: number },
  ) =>
    (timeUse.get(`${userKey}:${date}`) ?? []).some((other) =>
      overlaps(other, range),
    );
  const occupyTime = (
    userKey: string,
    date: string,
    range: { start: number; end: number },
  ) => {
    const key = `${userKey}:${date}`;
    timeUse.set(key, [...(timeUse.get(key) ?? []), range]);
  };

  type Candidate = {
    key: string;
    source: ExpandedBookingSource;
    id: string;
    spaceId: string;
    date: string;
    startMinutes: number;
    endMinutes: number;
    userKey: string;
    teamId: string | null;
    title: string | null;
    attendeeCount: number | null;
    participantKeys: string[];
    createdDaysBefore: number;
    status: "confirmed" | "cancelled";
    cancelledByKey: string | null;
    cancelKind: "operator" | "maintenance" | null;
    cancelReason: string | null;
    messages: readonly {
      authorKey: string;
      minutesFromStart: number;
      body: string;
    }[];
    strict: boolean;
  };

  /** 한 자리를 넣어 본다. 되면 예약을 돌려주고, 안 되면 null(strict면 오류). */
  const place = (candidate: Candidate): ExpandedBooking | null => {
    const { space, floor, branch } = located(candidate.spaceId);
    const isDesk = space.type === "desk";
    const fail = (message: string) => {
      if (candidate.strict)
        throw new SeedError(
          `일정 ${candidate.key} (${candidate.date}): ${message}`,
        );
      return null;
    };
    const hours = getOpenHours(branch.openHours, candidate.date);
    if (!hours) return fail("쉬는 날이에요.");
    if (
      candidate.startMinutes < timeToMinutes(hours.open) ||
      candidate.endMinutes > timeToMinutes(hours.close)
    )
      return fail("운영 시간 밖이에요.");
    const during = {
      start: instant(
        branch,
        candidate.date,
        `${String(Math.floor(candidate.startMinutes / 60)).padStart(2, "0")}:${String(candidate.startMinutes % 60).padStart(2, "0")}`,
      ),
      end:
        candidate.endMinutes === 1_440
          ? instant(branch, addDays(candidate.date, 1), "00:00")
          : instant(
              branch,
              candidate.date,
              `${String(Math.floor(candidate.endMinutes / 60)).padStart(2, "0")}:${String(candidate.endMinutes % 60).padStart(2, "0")}`,
            ),
    };
    const range = { start: candidate.startMinutes, end: candidate.endMinutes };
    const minutes = candidate.endMinutes - candidate.startMinutes;
    const operator = lookup.operators.has(`${branch.id}:${candidate.userKey}`);
    // 한도: 운영자는 제한이 없고, 좌석은 기간만 본다.
    const limits = candidate.teamId
      ? defaultLimits.team_member
      : defaultLimits.user;
    const createdAt = new Date(
      Math.min(
        latestCreation.getTime(),
        during.start.getTime() - candidate.createdDaysBefore * DAY,
      ),
    );
    if (!operator) {
      const createdDate = localDate(createdAt, branch.timezone);
      const daysAhead = Math.round(
        (Date.parse(`${candidate.date}T00:00:00Z`) -
          Date.parse(`${createdDate}T00:00:00Z`)) /
          DAY,
      );
      if (daysAhead > limits.maxDaysAhead)
        return fail("예약 가능한 기간을 넘어요.");
    }
    if (candidate.status === "confirmed") {
      if (occupied(candidate.spaceId, candidate.date, range))
        return fail("같은 공간의 다른 예약과 겹쳐요.");
      if (isDesk && deskBusy(candidate.userKey, candidate.date, range))
        return fail("같은 사람의 좌석 예약과 겹쳐요.");
      if (!isDesk && timeBusy(candidate.userKey, candidate.date, range))
        return fail("같은 사람의 다른 예약과 겹쳐요.");
      if (!isDesk && !operator) {
        if (minutes > limits.maxMinutesPerBooking)
          return fail("1회 한도를 넘어요.");
        const key = candidate.teamId
          ? `${candidate.teamId}:${branch.id}:${candidate.date}`
          : `${candidate.userKey}:${branch.id}:${candidate.date}`;
        const used =
          (candidate.teamId ? teamMinutes : personalMinutes).get(key) ?? 0;
        if (used + minutes > limits.maxMinutesPerDay)
          return fail("하루 한도를 넘어요.");
      }
    }
    let status = candidate.status;
    let cancelledByKey = candidate.cancelledByKey;
    let cancelKind = candidate.cancelKind;
    let cancelReason = candidate.cancelReason;
    let cancelledAt: Date | null = null;
    const block = blocksFor(candidate.spaceId).find((row) =>
      overlaps(
        { start: row.during.start.getTime(), end: row.during.end.getTime() },
        { start: during.start.getTime(), end: during.end.getTime() },
      ),
    );
    if (block && status === "confirmed") {
      // 점검이 먼저 등록돼 있었으면 예약 자체가 생길 수 없다. 뒤에 등록된 점검은 예약을 취소시킨다.
      if (createdAt > block.createdAt) return fail("점검과 겹쳐요.");
      status = "cancelled";
      cancelledByKey = block.createdByKey;
      cancelKind = "maintenance";
      cancelReason = block.reason ?? "점검";
      cancelledAt = new Date(
        Math.max(createdAt.getTime() + MINUTE, block.createdAt.getTime()),
      );
    } else if (status === "cancelled") {
      cancelledAt = new Date(
        Math.min(
          now.getTime(),
          Math.max(
            createdAt.getTime() + MINUTE,
            during.start.getTime() - 2 * 60 * MINUTE,
          ),
        ),
      );
    }
    if (status === "confirmed") {
      occupy(candidate.spaceId, candidate.date, range);
      if (isDesk) occupyDesk(candidate.userKey, candidate.date, range);
      else occupyTime(candidate.userKey, candidate.date, range);
      if (!isDesk && !operator) {
        const key = candidate.teamId
          ? `${candidate.teamId}:${branch.id}:${candidate.date}`
          : `${candidate.userKey}:${branch.id}:${candidate.date}`;
        const map = candidate.teamId ? teamMinutes : personalMinutes;
        map.set(key, (map.get(key) ?? 0) + minutes);
      }
    }
    const messages = isDesk
      ? []
      : candidate.messages
          .map((row) => ({
            authorKey: row.authorKey,
            at: new Date(
              during.start.getTime() + row.minutesFromStart * MINUTE,
            ),
            body: row.body,
          }))
          .filter((row) => row.at <= now && row.at > createdAt);
    return {
      id: candidate.id,
      key: candidate.key,
      source: candidate.source,
      spaceId: candidate.spaceId,
      floorId: floor.id,
      branchId: branch.id,
      isDesk,
      date: candidate.date,
      during,
      userKey: candidate.userKey,
      teamId: candidate.teamId,
      title: candidate.title,
      attendeeCount: candidate.attendeeCount,
      participantKeys: [...candidate.participantKeys],
      createdAt,
      status,
      cancelledByKey,
      cancelledAt,
      cancelKind,
      cancelReason,
      messages,
    };
  };
  const push = (booking: ExpandedBooking | null) => {
    if (booking) bookings.push(booking);
  };

  // 2. 되풀이 예약
  for (const row of schedule.recurring) {
    const { branch } = located(row.spaceId);
    const occurrences: ExpandedBooking[] = [];
    for (const dayIndex of dayIndexes) {
      const id = seedScheduleId(`recurring:${row.key}:${dayIndex}`);
      bookingIds.push(id);
      const date = dateOf(branch, dayIndex);
      if (!row.weekdays.includes(weekday(date))) continue;
      const booking = place({
        key: row.key,
        source: "recurring",
        id,
        spaceId: row.spaceId,
        date,
        startMinutes: timeToMinutes(row.start),
        endMinutes: timeToMinutes(row.end),
        userKey: row.userKey,
        teamId: row.teamId,
        title: row.title,
        attendeeCount: row.attendeeCount,
        participantKeys: row.participantKeys,
        createdDaysBefore: row.createdDaysBefore,
        status: "confirmed",
        cancelledByKey: null,
        cancelKind: null,
        cancelReason: null,
        messages: [],
        strict: false,
      });
      if (booking) occurrences.push(booking);
    }
    const confirmed = occurrences.filter(
      (booking) => booking.status === "confirmed",
    );
    const previous = [...confirmed]
      .reverse()
      .find((booking) => booking.during.start < now);
    const next = confirmed.find((booking) => booking.during.start >= now);
    const attach = (
      target: ExpandedBooking | undefined,
      rows:
        | readonly {
            authorKey: string;
            minutesFromStart: number;
            body: string;
          }[]
        | undefined,
    ) => {
      if (!target || !rows) return;
      target.messages = rows
        .map((entry) => ({
          authorKey: entry.authorKey,
          at: new Date(
            target.during.start.getTime() + entry.minutesFromStart * MINUTE,
          ),
          body: entry.body,
        }))
        .filter((entry) => entry.at <= now && entry.at > target.createdAt);
    };
    attach(previous, row.messages?.previous);
    attach(next, row.messages?.next);
    bookings.push(...occurrences);
  }

  // 3. 한 번짜리 예약
  for (const row of schedule.oneOff) {
    const { branch } = located(row.spaceId);
    const id = seedScheduleId(`oneoff:${row.key}`);
    bookingIds.push(id);
    push(
      place({
        key: row.key,
        source: "oneOff",
        id,
        spaceId: row.spaceId,
        date: getOperatingDate(
          now,
          branch.timezone,
          branch.openHours,
          row.dayOffset,
        ),
        startMinutes: timeToMinutes(row.start),
        endMinutes: timeToMinutes(row.end),
        userKey: row.userKey,
        teamId: row.teamId,
        title: row.title,
        attendeeCount: row.attendeeCount,
        participantKeys: row.participantKeys,
        createdDaysBefore: row.createdDaysBefore,
        status: row.status,
        cancelledByKey: row.cancelledByKey,
        cancelKind: row.cancelKind,
        cancelReason: row.cancelReason,
        messages: row.messages ?? [],
        strict: true,
      }),
    );
  }

  // 4. 좌석 단골
  const deskRange = (
    branch: SeedData["branches"][number],
    date: string,
    part: DeskPart,
  ) => {
    const range = createDeskParts({
      date,
      timeZone: branch.timezone,
      openHours: branch.openHours,
    }).find((row) => row.part === part);
    if (!range) return null;
    return {
      startMinutes: minutesOf(new Date(range.start), branch.timezone, date),
      endMinutes: minutesOf(new Date(range.end), branch.timezone, date),
    };
  };
  for (const row of schedule.deskRegulars) {
    const { branch } = located(row.deskId);
    for (const dayIndex of dayIndexes) {
      const id = seedScheduleId(`desk:${row.key}:${dayIndex}`);
      bookingIds.push(id);
      const date = dateOf(branch, dayIndex);
      if (!row.weekdays.includes(weekday(date))) continue;
      const range = deskRange(branch, date, row.part);
      if (!range) continue;
      push(
        place({
          key: row.key,
          source: "deskRegular",
          id,
          spaceId: row.deskId,
          date,
          ...range,
          userKey: row.userKey,
          teamId: null,
          title: null,
          attendeeCount: null,
          participantKeys: [],
          createdDaysBefore: row.createdDaysBefore,
          status: "confirmed",
          cancelledByKey: null,
          cancelKind: null,
          cancelReason: null,
          messages: [],
          strict: false,
        }),
      );
    }
  }

  // 5. 채우기 (고정 난수)
  const dailyCount = (
    random: ReturnType<typeof createRandom>,
    row: {
      perDay: [number, number];
      weekendFactor: number;
      futureDecay: number;
    },
    date: string,
    dayIndex: number,
  ) => {
    let max = row.perDay[1];
    const day = weekday(date);
    if (day === "sat" || day === "sun")
      max = Math.round(max * row.weekendFactor);
    if (dayIndex > 0 && futureDays > 0)
      max = Math.round(max * (1 - row.futureDecay * (dayIndex / futureDays)));
    return random.int(Math.min(row.perDay[0], max), max);
  };
  for (const row of schedule.fill) {
    for (const spaceId of row.spaceIds) {
      const { branch } = located(spaceId);
      for (const dayIndex of dayIndexes) {
        for (let slot = 0; slot < row.perDay[1]; slot += 1)
          bookingIds.push(
            seedScheduleId(`fill:${row.key}:${spaceId}:${dayIndex}:${slot}`),
          );
        const date = dateOf(branch, dayIndex);
        const hours = getOpenHours(branch.openHours, date);
        if (!hours) continue;
        const random = createRandom(`fill:${row.key}:${spaceId}:${dayIndex}`);
        const count = dailyCount(random, row, date, dayIndex);
        const open = Math.max(
          timeToMinutes(hours.open),
          row.hours ? timeToMinutes(row.hours[0]) : 0,
        );
        const close = Math.min(
          timeToMinutes(hours.close),
          row.hours ? timeToMinutes(row.hours[1]) : 1_440,
        );
        for (let slot = 0; slot < count; slot += 1) {
          const duration = random.pick(row.durations);
          if (close - open < duration) continue;
          const latestStart = (close - duration - open) / SLOT_MINUTES;
          const startMinutes = open + random.int(0, latestStart) * SLOT_MINUTES;
          const userKey = random.pick(row.userKeys);
          const untitled =
            random.chance(row.untitledRate) || row.titles.length === 0;
          const cancelled = random.chance(row.cancelRate);
          const space = lookup.spaces.get(spaceId)!;
          const attendee =
            space.capacity && space.capacity > 1 && !untitled
              ? random.int(2, Math.min(space.capacity, 8))
              : null;
          push(
            place({
              key: `${row.key}:${slot}`,
              source: "fill",
              id: seedScheduleId(
                `fill:${row.key}:${spaceId}:${dayIndex}:${slot}`,
              ),
              spaceId,
              date,
              startMinutes,
              endMinutes: startMinutes + duration,
              userKey,
              teamId: row.teamId,
              title: untitled ? null : random.pick(row.titles),
              attendeeCount: attendee,
              participantKeys: [],
              createdDaysBefore: random.int(1, 5),
              status: cancelled ? "cancelled" : "confirmed",
              cancelledByKey: cancelled ? userKey : null,
              cancelKind: null,
              cancelReason: null,
              messages: [],
              strict: false,
            }),
          );
        }
      }
    }
  }
  for (const row of schedule.deskFill) {
    const { branch } = located(row.areaId);
    const desks = data.spaces
      .filter(
        (space) =>
          space.type === "desk" &&
          space.parentId === row.areaId &&
          space.bookable,
      )
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const dayIndex of dayIndexes) {
      for (let slot = 0; slot < row.perDay[1]; slot += 1)
        bookingIds.push(
          seedScheduleId(`deskfill:${row.key}:${dayIndex}:${slot}`),
        );
      const date = dateOf(branch, dayIndex);
      if (!getOpenHours(branch.openHours, date)) continue;
      const random = createRandom(`deskfill:${row.key}:${dayIndex}`);
      const count = dailyCount(random, row, date, dayIndex);
      for (let slot = 0; slot < count; slot += 1) {
        const desk = random.pick(desks);
        const part = random.pick(row.parts);
        const range = deskRange(branch, date, part);
        if (!range) continue;
        const userKey = random.pick(row.userKeys);
        const cancelled = random.chance(row.cancelRate);
        push(
          place({
            key: `${row.key}:${slot}`,
            source: "deskFill",
            id: seedScheduleId(`deskfill:${row.key}:${dayIndex}:${slot}`),
            spaceId: desk.id,
            date,
            ...range,
            userKey,
            teamId: null,
            title: null,
            attendeeCount: null,
            participantKeys: [],
            createdDaysBefore: random.int(0, 4),
            status: cancelled ? "cancelled" : "confirmed",
            cancelledByKey: cancelled ? userKey : null,
            cancelKind: null,
            cancelReason: null,
            messages: [],
            strict: false,
          }),
        );
      }
    }
  }

  // 6. 공지와 받는 사람
  const announcementIds: string[] = [];
  const announcements: ExpandedAnnouncement[] = [];
  for (const row of schedule.announcements) {
    const branch = lookup.branches.get(row.branchId)!;
    const id = seedScheduleId(`announce:${row.key}`);
    announcementIds.push(id);
    const at = instant(
      branch,
      addDays(localDate(now, branch.timezone), -row.daysAgo),
      row.time,
    );
    if (at > now) continue;
    let audience: ExpandedAnnouncement["audience"] = null;
    const recipients = new Set<string>();
    if (row.audience) {
      const date = getOperatingDate(
        now,
        branch.timezone,
        branch.openHours,
        row.audience.dayOffset,
      );
      audience = {
        date,
        floorId: row.audience.floorId,
        spaceId: row.audience.spaceId,
      };
      for (const booking of bookings) {
        if (booking.branchId !== branch.id || booking.date !== date) continue;
        if (audience.floorId && booking.floorId !== audience.floorId) continue;
        if (audience.spaceId && booking.spaceId !== audience.spaceId) continue;
        // 공지를 보낸 뒤에 취소된 예약도 받는 사람에 들어간다 (보낼 때는 확정이었다).
        if (
          booking.status === "cancelled" &&
          booking.cancelledAt &&
          booking.cancelledAt <= at
        )
          continue;
        if (booking.createdAt > at) continue;
        recipients.add(booking.userKey);
        for (const key of booking.participantKeys) recipients.add(key);
      }
      recipients.delete(row.authorKey);
    }
    announcements.push({
      id,
      key: row.key,
      branchId: branch.id,
      authorKey: row.authorKey,
      at,
      title: row.title,
      body: row.body,
      audience,
      recipientKeys: [...recipients].sort(),
    });
  }

  bookings.sort(
    (a, b) =>
      a.during.start.getTime() - b.during.start.getTime() ||
      a.id.localeCompare(b.id),
  );
  return {
    window: schedule.window,
    bookings,
    blocks,
    announcements,
    bookingIds,
    blockIds,
    announcementIds,
  };
}

/** 지점 묶음만 고를 때 쓴다. 예약·점검은 공간으로, 공지는 지점으로 가른다. */
export function selectScheduleForBranches(
  schedule: ExpandedSchedule,
  branchIds: readonly string[],
): ExpandedSchedule {
  const selected = new Set(branchIds);
  const bookings = schedule.bookings.filter((row) =>
    selected.has(row.branchId),
  );
  const blocks = schedule.blocks.filter((row) => selected.has(row.branchId));
  const announcements = schedule.announcements.filter((row) =>
    selected.has(row.branchId),
  );
  return {
    ...schedule,
    bookings,
    blocks,
    announcements,
    bookingIds: bookings.map(({ id }) => id),
    blockIds: blocks.map(({ id }) => id),
    announcementIds: announcements.map(({ id }) => id),
  };
}
