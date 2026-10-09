import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import {
  addDays,
  isValidTimeZone,
  localDate,
  localTime,
  SLOT_MINUTES,
  timeToMinutes,
  zonedDateTime,
} from "@/lib/time/zoned";
import type { MaintenanceStart } from "./maintenance-types";
import type { SpaceType } from "@/features/bookings/types";

const id = z.uuid().transform((value) => value.toLowerCase());
const instant = z.iso
  .datetime({ offset: true })
  .refine((value) => {
    // Date는 밀리초 아래 자릿수를 버린다. 그 값이 0이 아닌 입력을 정렬된
    // 시각으로 잘못 승인하지 않도록 변환 전에 검사한다.
    return !/\.\d*[1-9]\d*(?:Z|[+-]\d{2}:\d{2})$/.test(value);
  }, "시각은 초 없이 입력해 주세요.")
  .transform((value) => new Date(value).toISOString());
export const maintenanceStartSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("now") }),
  z.strictObject({ kind: z.literal("at"), at: instant }),
]);
const reason = z
  .string()
  .trim()
  .refine((value) => {
    const length = Array.from(value).length;
    return length >= 1 && length <= 100 && !value.includes("\0");
  }, "이유를 1–100자로 입력해 주세요.");
const expectedBookingIds = z
  .array(id)
  .refine(
    (ids) => new Set(ids).size === ids.length,
    "같은 예약을 두 번 보낼 수 없어요.",
  );
const windowFields = { start: maintenanceStartSchema, end: instant };
export const previewMaintenanceSchema = z.strictObject({
  spaceId: id,
  ...windowFields,
});
export const createMaintenanceSchema = previewMaintenanceSchema.extend({
  reason,
  expectedBookingIds,
});
export const updateMaintenanceSchema = z.strictObject({
  blockId: id,
  ...windowFields,
  reason,
  expectedBookingIds,
});
export const blockIdSchema = z.strictObject({ blockId: id });
export const maintenanceListSchema = z.strictObject({
  branchId: id,
  tab: z.enum(["active", "past"]).default("active"),
});
export type PreviewMaintenanceInput = z.input<typeof previewMaintenanceSchema>;
export type MaintenanceListInput = z.input<typeof maintenanceListSchema>;

export function ensureMaintenanceSpace<
  T extends {
    space: {
      floorId: string;
      parentId: string | null;
      type: SpaceType;
      archivedAt: Date | null;
    };
    parent: {
      id: string;
      floorId: string;
      type: SpaceType;
      archivedAt: Date | null;
    } | null;
  },
>(row: T | null): T {
  if (!row || row.space.archivedAt || row.space.type === "lounge")
    throw new ActionError("NOT_FOUND");
  if (
    row.space.type === "desk" &&
    (!row.parent ||
      row.parent.id !== row.space.parentId ||
      row.parent.type !== "desk_area" ||
      row.parent.floorId !== row.space.floorId ||
      row.parent.archivedAt)
  )
    throw new ActionError("NOT_FOUND");
  return row;
}

function invalid(field: "start" | "end", text: string): never {
  throw new ActionError("INVALID_INPUT", { fieldErrors: { [field]: [text] } });
}
function aligned(
  value: string,
  timeZone: string,
  field: "start" | "end",
): Date {
  const parsed = instant.safeParse(value);
  if (!parsed.success) invalid(field, "올바른 시각을 입력해 주세요.");
  const date = new Date(parsed.data);
  if (
    timeToMinutes(localTime(date, timeZone)) % SLOT_MINUTES !== 0 ||
    date.getUTCSeconds() !== 0 ||
    date.getUTCMilliseconds() !== 0
  )
    invalid(field, "시각은 30분 단위로 입력해 주세요.");
  return date;
}

export function validateMaintenanceWindow({
  start: input,
  end: value,
  now,
  timeZone,
}: {
  start: MaintenanceStart;
  end: string;
  now: Date;
  timeZone: string;
}): { start: Date; end: Date } {
  if (!Number.isFinite(now.getTime()) || !isValidTimeZone(timeZone))
    invalid("start", "기준 시각을 확인할 수 없어요.");
  const start =
    input.kind === "now"
      ? new Date(Math.floor(now.getTime() / 60_000) * 60_000)
      : aligned(input.at, timeZone, "start");
  if (input.kind === "at" && start < now)
    invalid("start", "시작은 지금 이후여야 해요.");
  const end = aligned(value, timeZone, "end");
  if (end <= start) invalid("end", "끝은 시작보다 늦어야 해요.");
  let maximum: Date;
  try {
    maximum = zonedDateTime(
      addDays(localDate(start, timeZone), 30),
      localTime(start, timeZone),
      timeZone,
    );
  } catch {
    invalid("end", "점검 기간을 다시 확인해 주세요.");
  }
  if (end > maximum) invalid("end", "점검은 시작부터 30일 안에 끝나야 해요.");
  return { start, end };
}
