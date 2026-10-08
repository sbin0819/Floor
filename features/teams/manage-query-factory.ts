import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import { getTeamMember } from "@/lib/dal/teams-read";
import {
  listTeamAccessGrants,
  listTeamBookingBranches,
  readTeamBookingRows,
  readTeamDeleteCounts,
  readTeamRemovalPreview,
} from "@/lib/dal/teams-management-read";
import { loadPermissionContext } from "@/lib/permissions/context";
import { canCancelBooking } from "@/features/bookings/visibility";
import { canManageTeam } from "./action-factory";
import type { TeamQueryDependencies } from "./query-factory";
import type {
  TeamBookingsData,
  TeamDeletePreview,
  TeamRemovalPreview,
} from "./types";

const idSchema = z.uuid().transform((id) => id.toLowerCase());
const bookingQuerySchema = z.strictObject({
  view: z.enum(["upcoming", "past", "cancelled"]).default("upcoming"),
  branchId: idSchema.optional(),
});
function idOf(value: unknown) {
  const parsed = idSchema.safeParse(value);
  if (!parsed.success) throw new ActionError("NOT_FOUND");
  return parsed.data;
}

export function createTeamManagementQueries(
  dependencies: TeamQueryDependencies = {},
) {
  const database = dependencies.database;
  const sessionOf = dependencies.requireSession ?? requireSession;
  const now = dependencies.now ?? (() => new Date());
  return {
    async getTeamBookings(
      teamId: string,
      query: unknown = {},
    ): Promise<TeamBookingsData> {
      const session = await sessionOf();
      teamId = idOf(teamId);
      const parsed = bookingQuerySchema.safeParse(query);
      if (!parsed.success) throw new ActionError("INVALID_INPUT");
      const current = now();
      const [membership, rows, branches] = await Promise.all([
        getTeamMember(teamId, session.userId, database),
        readTeamBookingRows(
          { teamId, userId: session.userId, ...parsed.data, now: current },
          database,
        ),
        listTeamBookingBranches(teamId, session.userId, database),
      ]);
      if (!membership) throw new ActionError("NOT_FOUND");
      const context = rows.length
        ? await loadPermissionContext(
            session,
            [...new Set(rows.map((row) => row.branchId))],
            database,
          )
        : null;
      return {
        teamId,
        view: parsed.data.view,
        branchId: parsed.data.branchId ?? null,
        branches,
        now: current.toISOString(),
        bookings: rows.map((row) => ({
          id: row.id,
          kind: row.kind,
          startAt: row.during.start.toISOString(),
          endAt: row.during.end.toISOString(),
          title: row.title,
          spaceName: row.spaceName,
          floorName: row.floorName,
          branchName: row.branchName,
          timezone: row.timezone,
          restricted: row.restricted,
          booker: row.booker,
          participantCount: row.participantCount,
          canChat: row.canChat,
          canCancel:
            parsed.data.view === "upcoming" &&
            context !== null &&
            canCancelBooking(context, row, row.branchId),
        })),
      };
    },
    async getTeamRemovalPreview(
      teamId: string,
      userId: string,
    ): Promise<TeamRemovalPreview> {
      const session = await sessionOf();
      teamId = idOf(teamId);
      userId = idOf(userId);
      const [membership, target, manager] = await Promise.all([
        getTeamMember(teamId, session.userId, database),
        getTeamMember(teamId, userId, database),
        userId === session.userId
          ? Promise.resolve(false)
          : canManageTeam(session, teamId, database),
      ]);
      if (!membership || !target) throw new ActionError("NOT_FOUND");
      if (userId !== session.userId && !manager)
        throw new ActionError("FORBIDDEN");
      const { bookingCount, firstBooking } = await readTeamRemovalPreview(
        teamId,
        userId,
        now(),
        database,
      );
      return {
        teamId,
        userId,
        bookingCount,
        firstBooking: firstBooking
          ? {
              id: firstBooking.id,
              startAt: firstBooking.during.start.toISOString(),
              endAt: firstBooking.during.end.toISOString(),
              spaceName: firstBooking.spaceName,
              floorName: firstBooking.floorName,
              branchName: firstBooking.branchName,
              timezone: firstBooking.timezone,
            }
          : null,
      };
    },
    async getTeamDeletePreview(teamId: string): Promise<TeamDeletePreview> {
      const session = await sessionOf();
      teamId = idOf(teamId);
      const [membership, manager] = await Promise.all([
        getTeamMember(teamId, session.userId, database),
        canManageTeam(session, teamId, database),
      ]);
      if (!membership) throw new ActionError("NOT_FOUND");
      if (!manager) throw new ActionError("FORBIDDEN");
      const [counts, grants] = await Promise.all([
        readTeamDeleteCounts(teamId, now(), database),
        listTeamAccessGrants(teamId, database),
      ]);
      if (!counts) throw new ActionError("NOT_FOUND");
      return { teamId, ...counts, accessGrants: grants };
    },
  };
}
