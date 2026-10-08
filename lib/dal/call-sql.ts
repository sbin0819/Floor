import "server-only";

import { sql, type SQL } from "drizzle-orm";
import type { CallView } from "@/features/calls/types";
import type { DalDatabase } from "./database";
import { activeCallParticipant } from "./call-read";

// 목록에서는 라운지 이름을 읽지 않고, 방 조회는 현재 참가한 사람에게만 읽는다.
export function callSnapshot(
  userId: string,
  roomId: SQL,
  spaceKind: SQL,
  now: Date,
  database: DalDatabase,
  navigation = false,
) {
  const active = activeCallParticipant(now, {
    leftAt: sql`person.left_at`,
    lastSeenAt: sql`person.last_seen_at`,
  });
  const showNames = navigation
    ? sql`${spaceKind} is distinct from 'branch'`
    : sql`(${spaceKind} is distinct from 'branch' or exists (
        select 1 from call_participants person where person.session_id = live_call.id
          and person.user_id = ${userId}::uuid and ${active}))`;
  return database
    .select({
      call: sql<CallView>`jsonb_build_object(
      'sessionId', live_call.id, 'kind', live_call.kind, 'startedAt', live_call.started_at,
      'participantCount', (select count(*)::int from call_participants person
        where person.session_id = live_call.id and ${active}),
      'participants', case when ${showNames} then coalesce((select jsonb_agg(roster.item order by roster.name, roster.id) from (
        select member.name, member.id, jsonb_build_object('userId', member.id, 'name', member.name) item
        from call_participants person join users member on member.id = person.user_id
        where person.session_id = live_call.id and ${active}
        order by member.name, member.id limit 25
      ) roster), '[]'::jsonb) else '[]'::jsonb end
    )`.as("call"),
    })
    .from(sql`call_sessions live_call`)
    .where(sql`live_call.room_id = ${roomId} and live_call.ended_at is null`)
    .limit(1)
    .as("call_snapshot");
}
