import "server-only";

import { asc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  bookingParticipants,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import type { DalDatabase } from "./database";

export async function listBookingParticipantDetails(
  bookingId: string,
  ownerId: string,
  database: DalDatabase = getDb(),
) {
  // 기존 참석자의 인증 상태나 현재 팀 소속은 명단을 지우는 조건이 아니다.
  return database
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      sharedTeamNames: sql<string[]>`coalesce((
      select jsonb_agg(t.name order by t.name, t.id)
      from ${teamMembers} mine
      join ${teamMembers} theirs on theirs.team_id = mine.team_id
      join ${teams} t on t.id = mine.team_id
      where mine.user_id = ${ownerId} and theirs.user_id = ${users}.${sql.identifier("id")}
    ), '[]'::jsonb)`,
    })
    .from(bookingParticipants)
    .innerJoin(users, eq(users.id, bookingParticipants.userId))
    .where(eq(bookingParticipants.bookingId, bookingId))
    .orderBy(asc(users.name), asc(users.id));
}
