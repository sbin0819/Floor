import "server-only";

import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { chatSpaces, teamMembers, teams } from "@/lib/db/schema";
import { readableTeamSpace } from "./chat-access";
import type { DalDatabase } from "./database";

export function listRealtimeSpaces(
  userId: string,
  database: DalDatabase = getDb(),
) {
  return database
    .select({ id: chatSpaces.id })
    .from(chatSpaces)
    .innerJoin(teams, eq(teams.id, chatSpaces.teamId))
    .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
    .where(readableTeamSpace(userId))
    .orderBy(asc(teams.name), asc(chatSpaces.id))
    .limit(100);
}
