import "server-only";

import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { ActionError } from "@/lib/actions/result";
import {
  accessGrants,
  chatSpaces,
  spaces,
  teamInvites,
  teamJoinRequests,
  teamMembers,
  teams,
} from "@/lib/db/schema";
import type { DalDatabase } from "./database";

export async function listTeamMemberUserIds(
  teamId: string,
  database: DalDatabase,
) {
  const rows = await database
    .select({ userId: teamMembers.userId })
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(asc(teamMembers.userId));
  return rows.map(({ userId }) => userId);
}

export async function removeAllTeamMembers(
  teamId: string,
  database: DalDatabase,
) {
  await database.delete(teamMembers).where(eq(teamMembers.teamId, teamId));
}

export async function closeTeamInvitations(
  input: { teamId: string; actorId: string; now: Date },
  database: DalDatabase,
) {
  await database
    .update(teamInvites)
    .set({ revokedAt: input.now })
    .where(
      and(
        eq(teamInvites.teamId, input.teamId),
        isNull(teamInvites.acceptedAt),
        isNull(teamInvites.declinedAt),
        isNull(teamInvites.revokedAt),
      ),
    )
    .returning({ id: teamInvites.id });
  await database
    .update(teamJoinRequests)
    .set({
      status: "rejected",
      decidedBy: input.actorId,
      decidedAt: input.now,
    })
    .where(
      and(
        eq(teamJoinRequests.teamId, input.teamId),
        eq(teamJoinRequests.status, "pending"),
      ),
    )
    .returning({ id: teamJoinRequests.id });
}

export async function removeTeamAccessGrants(
  teamId: string,
  database: DalDatabase,
) {
  const grants = await database
    .delete(accessGrants)
    .where(eq(accessGrants.teamId, teamId))
    .returning({
      targetType: accessGrants.targetType,
      targetId: accessGrants.targetId,
    });
  if (!grants.length) return [];
  const floors = grants
    .filter(({ targetType }) => targetType === "floor")
    .map(({ targetId }) => targetId);
  const targets = grants
    .filter(({ targetType }) => targetType === "space")
    .map(({ targetId }) => targetId);
  return database
    .select({ floorId: spaces.floorId, spaceId: spaces.id })
    .from(spaces)
    .where(
      or(
        floors.length ? inArray(spaces.floorId, floors) : undefined,
        targets.length ? inArray(spaces.id, targets) : undefined,
      ),
    )
    .orderBy(asc(spaces.id));
}

export async function softDeleteTeamSpace(
  spaceId: string,
  now: Date,
  database: DalDatabase,
) {
  await database
    .update(chatSpaces)
    .set({ deletedAt: now })
    .where(and(eq(chatSpaces.id, spaceId), isNull(chatSpaces.deletedAt)))
    .returning({ id: chatSpaces.id });
}

export async function softDeleteTeam(
  input: { teamId: string; actorId: string; now: Date },
  database: DalDatabase,
) {
  const [row] = await database
    .update(teams)
    .set({ deletedAt: input.now, deletedBy: input.actorId })
    .where(and(eq(teams.id, input.teamId), isNull(teams.deletedAt)))
    .returning({ id: teams.id });
  if (!row) throw new ActionError("NOT_FOUND");
}
