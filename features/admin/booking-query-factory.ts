import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import { toAvatar } from "@/lib/avatar";
import { getBranch, listFloorsWithAccess } from "@/lib/dal/branches";
import {
  countAdminBookings,
  listAdminBookingRows,
} from "@/lib/dal/admin-bookings";
import { can } from "@/lib/permissions/can";
import { loadPermissionContext } from "@/lib/permissions/context";
import { normalizeTeamName } from "@/lib/teams/normalize";
import { addDays, localDate, zonedDateTime } from "@/lib/time/zoned";
import {
  classifyDeskPart,
  createDeskParts,
} from "@/features/bookings/desk-parts";
import { readBookingNow } from "@/features/bookings/request-clock";
import type { AdminQueryDependencies } from "./query-factory";
import type { AdminBookingsData } from "./booking-types";

export const adminBookingsSchema = z
  .strictObject({
    branchId: z.uuid(),
    date: z.iso.date().optional(),
    days: z.union([z.literal(1), z.literal(7)]).default(1),
    floorId: z.uuid().optional(),
    type: z
      .enum([
        "meeting_room",
        "phone_booth",
        "seminar",
        "desk_area",
        "desk",
        "lounge",
      ])
      .optional(),
    status: z.enum(["confirmed", "cancelled", "all"]).default("confirmed"),
    q: z
      .string()
      .transform(normalizeTeamName)
      .refine((value) => !value.includes("\0"))
      .refine(
        (value) =>
          value === "" ||
          (Array.from(value).length >= 2 && Array.from(value).length <= 40),
      )
      .default(""),
    page: z.number().int().min(1).max(1_000_000).default(1),
  })
  .superRefine(({ date, days }, ctx) => {
    if (!date) return;
    try {
      addDays(date, days);
    } catch {
      ctx.addIssue({
        code: "custom",
        path: ["date"],
        message: "조회할 수 있는 날짜를 골라 주세요",
      });
    }
  });
export type AdminBookingsInput = z.input<typeof adminBookingsSchema>;

export function createAdminBookingQueries(
  dependencies: AdminQueryDependencies = {},
) {
  const db = dependencies.database;
  return {
    async getAdminBookings(
      input: AdminBookingsInput,
    ): Promise<AdminBookingsData> {
      const session = await (dependencies.requireSession ?? requireSession)();
      const parsed = adminBookingsSchema.safeParse(input);
      if (!parsed.success) throw new ActionError("INVALID_INPUT");
      const value = parsed.data;
      value.branchId = value.branchId.toLowerCase();
      const [branch, context, floors] = await Promise.all([
        getBranch(value.branchId, db),
        loadPermissionContext(session, value.branchId, db),
        listFloorsWithAccess(value.branchId, db),
      ]);
      if (!branch || !context.staffBranchIds.includes(branch.id))
        throw new ActionError("NOT_FOUND");
      if (!can(context, "booking.manage_all", { branchId: branch.id }))
        throw new ActionError("FORBIDDEN");
      if (
        value.floorId &&
        !floors.some(({ id }) => id === value.floorId?.toLowerCase())
      )
        throw new ActionError("NOT_FOUND");
      const now = dependencies.now?.() ?? readBookingNow(db !== undefined);
      const date = value.date ?? localDate(now, branch.timezone);
      const filters = { ...value, date, floorId: value.floorId?.toLowerCase() };
      const query = {
        ...filters,
        start: zonedDateTime(date, "00:00", branch.timezone),
        end: zonedDateTime(addDays(date, value.days), "00:00", branch.timezone),
      };
      const [rows, total] = await Promise.all([
        listAdminBookingRows(query, db),
        countAdminBookings(query, db),
      ]);
      return {
        branch: { id: branch.id, name: branch.name, timezone: branch.timezone },
        floors: floors.map(({ id, name }) => ({ id, name })),
        filters,
        now: now.toISOString(),
        total,
        rows: rows.map((row) => ({
          id: row.id,
          start: row.during.start.toISOString(),
          end: row.during.end.toISOString(),
          floorName: row.floorName,
          spaceName: row.spaceName,
          spaceType: row.spaceType,
          areaName: row.areaName,
          deskPart:
            row.spaceType === "desk"
              ? classifyDeskPart(
                  row.during,
                  createDeskParts({
                    date: localDate(row.during.start, branch.timezone),
                    timeZone: branch.timezone,
                    openHours: branch.openHours,
                  }),
                )
              : null,
          bookerName: row.bookerName,
          avatar: toAvatar({
            id: row.userId,
            avatarColor: row.avatarColor,
            avatarPhoto: row.avatarPhoto,
            avatarUrl: row.avatarUrl,
          }),
          teamName: row.teamName,
          title: row.title,
          attendeeCount: row.attendeeCount,
          participantCount: row.participantCount,
          status: row.status,
          cancelledByOwner: row.cancelledByOwner,
          cancelKind: row.cancelKind,
          cancelReason: row.cancelReason,
          canCancel: row.status === "confirmed" && row.during.end > now,
        })),
      };
    },
  };
}
