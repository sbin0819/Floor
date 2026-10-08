import "server-only";

import { and, asc, count, eq, isNull } from "drizzle-orm";
import { ActionError } from "@/lib/actions/result";
import {
  branches,
  chatRooms,
  chatSpaces,
  teamMembers,
  teams,
} from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import type { DalDatabase } from "./database";

export function lockTeamMembers(teamId: string, database: DalDatabase) {
  return database
    .select()
    .from(teamMembers)
    .where(eq(teamMembers.teamId, teamId))
    .orderBy(asc(teamMembers.userId))
    .for("update");
}

export async function countManagedTeams(userId: string, database: DalDatabase) {
  const [row] = await database
    .select({ total: count() })
    .from(teamMembers)
    .innerJoin(teams, eq(teams.id, teamMembers.teamId))
    .where(
      and(
        eq(teamMembers.userId, userId),
        eq(teamMembers.role, "admin"),
        isNull(teams.deletedAt),
      ),
    );
  return row?.total ?? 0;
}

export async function assertTeamHomeBranch(
  branchId: string | null,
  database: DalDatabase,
) {
  const [branch] = await database
    .select({ id: branches.id })
    .from(branches)
    .where(branchId ? eq(branches.id, branchId) : undefined)
    .limit(1);
  if (branchId ? !branch : !!branch)
    throw new ActionError("INVALID_INPUT", {
      fieldErrors: { homeBranchId: ["주 이용 지점을 확인해 주세요"] },
    });
}

export async function updateTeamRecord(
  teamId: string,
  values: {
    name: string;
    homeBranchId: string | null;
    headcount: number;
    contactPhone: string;
  },
  database: DalDatabase,
) {
  const [row] = await database
    .update(teams)
    .set(values)
    .where(and(eq(teams.id, teamId), isNull(teams.deletedAt)))
    .returning({ id: teams.id });
  if (!row) throw new ActionError("NOT_FOUND");
  return row;
}

export async function updateMemberRole(
  input: {
    teamId: string;
    userId: string;
    from: "admin" | "member";
    role: "admin" | "member";
  },
  database: DalDatabase,
) {
  const [row] = await database
    .update(teamMembers)
    .set({ role: input.role })
    .where(
      and(
        eq(teamMembers.teamId, input.teamId),
        eq(teamMembers.userId, input.userId),
        eq(teamMembers.role, input.from),
      ),
    )
    .returning({ userId: teamMembers.userId });
  if (!row) throw new ActionError("NOT_FOUND");
}

export async function updateMemberTitle(
  input: { teamId: string; userId: string; title: string | null },
  database: DalDatabase,
) {
  const [row] = await database
    .update(teamMembers)
    .set({ title: input.title })
    .where(
      and(
        eq(teamMembers.teamId, input.teamId),
        eq(teamMembers.userId, input.userId),
      ),
    )
    .returning({ userId: teamMembers.userId });
  if (!row) throw new ActionError("NOT_FOUND");
}

export async function getTeamChatSpace(
  teamId: string,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({ id: chatSpaces.id })
    .from(chatSpaces)
    .where(
      and(
        eq(chatSpaces.kind, "team"),
        eq(chatSpaces.teamId, teamId),
        isNull(chatSpaces.deletedAt),
      ),
    );
  return row ?? null;
}

export async function lockTeamChatSpace(teamId: string, database: DalDatabase) {
  const [row] = await database
    .select({ id: chatSpaces.id })
    .from(chatSpaces)
    .where(
      and(
        eq(chatSpaces.kind, "team"),
        eq(chatSpaces.teamId, teamId),
        isNull(chatSpaces.deletedAt),
      ),
    )
    .for("update");
  return row ?? null;
}

export async function lockFirstTeamTextChannel(
  spaceId: string,
  database: DalDatabase,
) {
  const [candidate] = await database
    .select({ id: chatRooms.id })
    .from(chatRooms)
    .where(
      and(
        eq(chatRooms.spaceId, spaceId),
        eq(chatRooms.kind, "text"),
        isNull(chatRooms.archivedAt),
      ),
    )
    .orderBy(asc(chatRooms.createdAt), asc(chatRooms.id))
    .limit(1);
  if (!candidate) return null;
  const [room] = await database
    .select({ id: chatRooms.id, archivedAt: chatRooms.archivedAt })
    .from(chatRooms)
    .where(
      and(
        eq(chatRooms.id, candidate.id),
        eq(chatRooms.spaceId, spaceId),
        eq(chatRooms.kind, "text"),
      ),
    )
    .for("update");
  return room && !room.archivedAt ? room : null;
}
