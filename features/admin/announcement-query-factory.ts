import { z } from "zod";
import { readBookingNow } from "@/features/bookings/request-clock";
import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import {
  countAnnouncementRecipients,
  listAnnouncementFloors,
  listAnnouncementRows,
  loungeAvailability,
  readAnnouncementBranch,
} from "@/lib/dal/announcements-read";
import { loadPermissionContext } from "@/lib/permissions/context";
import { addDays, localDate, zonedDateTime } from "@/lib/time/zoned";
import {
  getAnnouncementsInputSchema,
  previewAnnouncementAudienceSchema,
  requireAnnouncementPermission,
  validateAnnouncementAudience,
  type GetAnnouncementsInput,
  type PreviewAnnouncementAudienceInput,
} from "./announcement-schema";
import type {
  AnnouncementAudiencePreview,
  AnnouncementsData,
  LoungeAvailability,
} from "./announcement-types";
import type { AdminQueryDependencies } from "./query-factory";

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ActionError("INVALID_INPUT", {
      fieldErrors: z.flattenError(result.error).fieldErrors as Record<
        string,
        string[]
      >,
    });
  return result.data;
}
function publicLounge(value: LoungeAvailability): LoungeAvailability {
  return {
    available: value.available,
    reason: value.reason,
    memberCount: value.memberCount,
  };
}
export function createAnnouncementQueries(
  dependencies: AdminQueryDependencies = {},
) {
  const db = dependencies.database;
  const readSession = dependencies.requireSession ?? requireSession;
  const readNow = () =>
    dependencies.now?.() ?? readBookingNow(db !== undefined);
  return {
    async getAnnouncements(
      input: GetAnnouncementsInput,
    ): Promise<AnnouncementsData> {
      const session = await readSession();
      const value = parse(getAnnouncementsInputSchema, input);
      const now = readNow();
      const scope = { branchId: value.branchId, operatorId: session.userId };
      const [metadata, context, lounge] = await Promise.all([
        readAnnouncementBranch(scope, db),
        loadPermissionContext(session, value.branchId, db),
        loungeAvailability(scope, db),
      ]);
      if (!metadata) throw new ActionError("NOT_FOUND");
      requireAnnouncementPermission(context, value.branchId);
      const today = localDate(now, metadata.branch.timezone);
      const [rows, floors] = await Promise.all([
        listAnnouncementRows(
          {
            ...scope,
            now,
            cutoff: zonedDateTime(
              addDays(today, -30),
              "00:00",
              metadata.branch.timezone,
            ),
          },
          db,
        ),
        listAnnouncementFloors(scope, db),
      ]);
      return {
        branch: metadata.branch,
        now: now.toISOString(),
        today,
        maxDate: addDays(today, 30),
        floors,
        lounge: publicLounge(lounge),
        rows: rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    },
    async previewAnnouncementAudience(
      input: PreviewAnnouncementAudienceInput,
    ): Promise<AnnouncementAudiencePreview> {
      const session = await readSession();
      const value = parse(previewAnnouncementAudienceSchema, input);
      const scope = { branchId: value.branchId, operatorId: session.userId };
      const [metadata, context] = await Promise.all([
        readAnnouncementBranch(scope, db),
        loadPermissionContext(session, value.branchId, db),
      ]);
      if (!metadata) throw new ActionError("NOT_FOUND");
      requireAnnouncementPermission(context, value.branchId);
      const during = validateAnnouncementAudience(value.audience, {
        timezone: metadata.branch.timezone,
        floors: metadata.floors,
        now: readNow(),
      });
      const [lounge, recipientCount] = await Promise.all([
        loungeAvailability(scope, db),
        value.audience && during
          ? countAnnouncementRecipients(
              {
                ...scope,
                ...during,
                floorId: value.audience.floorId,
                spaceId: value.audience.spaceId,
              },
              db,
            )
          : Promise.resolve(0),
      ]);
      return {
        branchId: value.branchId,
        lounge: publicLounge(lounge),
        recipientCount,
      };
    },
  };
}
