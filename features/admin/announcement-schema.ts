import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import { can } from "@/lib/permissions/can";
import type { PermissionContext } from "@/lib/permissions/types";
import { addDays, localDate, zonedDateTime } from "@/lib/time/zoned";
import type { AnnouncementAudience } from "./announcement-types";

const id = z.uuid().transform((value) => value.toLowerCase());
export const announcementAudienceSchema = z
  .strictObject({
    date: z.iso.date(),
    floorId: id.nullable(),
    spaceId: id.nullable(),
  })
  .refine((value) => value.spaceId === null || value.floorId !== null, {
    path: ["spaceId"],
    message: "공간의 층을 먼저 골라 주세요.",
  });
export const getAnnouncementsInputSchema = z.strictObject({ branchId: id });
export const previewAnnouncementAudienceSchema = z.strictObject({
  branchId: id,
  lounge: z.boolean(),
  audience: announcementAudienceSchema.nullable(),
});
function text(max: number) {
  return z
    .string()
    .trim()
    .refine((value) => {
      const length = Array.from(value).length;
      return (
        length >= 1 &&
        length <= max &&
        !value.includes("\0") &&
        !value.includes("<@")
      );
    }, `1–${max}자로 입력하고 멘션 표기는 넣지 말아 주세요.`);
}
export const sendAnnouncementSchema = previewAnnouncementAudienceSchema
  .extend({
    title: text(60),
    body: text(500),
  })
  .refine((value) => value.lounge || value.audience !== null, {
    path: ["lounge"],
    message: "받는 곳을 하나 이상 골라 주세요.",
  });
export type GetAnnouncementsInput = z.input<typeof getAnnouncementsInputSchema>;
export type PreviewAnnouncementAudienceInput = z.input<
  typeof previewAnnouncementAudienceSchema
>;
export type SendAnnouncementInput = z.input<typeof sendAnnouncementSchema>;

export function requireAnnouncementPermission(
  context: PermissionContext,
  branchId: string,
) {
  if (!context.staffBranchIds.includes(branchId))
    throw new ActionError("NOT_FOUND");
  if (!can(context, "branch.announce", { branchId }))
    throw new ActionError("FORBIDDEN");
}

export function validateAnnouncementAudience(
  audience: AnnouncementAudience | null,
  context: {
    timezone: string;
    floors: readonly { id: string; spaces: readonly { id: string }[] }[];
    now: Date;
  },
): { start: Date; end: Date } | null {
  if (audience === null) return null;
  const today = localDate(context.now, context.timezone);
  if (audience.date < today || audience.date > addDays(today, 30))
    throw new ActionError("INVALID_INPUT", {
      fieldErrors: { date: ["오늘부터 30일 안의 날짜를 골라 주세요."] },
    });
  const floor = context.floors.find(({ id }) => id === audience.floorId);
  if (audience.floorId !== null && !floor)
    throw new ActionError("INVALID_INPUT", {
      fieldErrors: { floorId: ["이 지점의 층을 골라 주세요."] },
    });
  if (
    audience.spaceId !== null &&
    !floor?.spaces.some(({ id }) => id === audience.spaceId)
  )
    throw new ActionError("INVALID_INPUT", {
      fieldErrors: { spaceId: ["이 층의 공간을 골라 주세요."] },
    });
  return {
    start: zonedDateTime(audience.date, "00:00", context.timezone),
    end: zonedDateTime(addDays(audience.date, 1), "00:00", context.timezone),
  };
}
