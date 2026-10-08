import "server-only";

import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  chatSpaceInvites,
  chatSpaces,
  teamJoinRequests,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import type { DalDatabase } from "./database";
import { usableInvite } from "./chat-space-invites";
import { messageRequestCount } from "./message-requests-read";
import { receivedFriendRequestCount } from "./people-read";

export async function readHomeTodo(
  me: string,
  now: Date,
  database: DalDatabase = getDb(),
) {
  const requestCount = sql<number>`count(*)::int`;
  const [joinRequests, [counts], [invite]] = await Promise.all([
    database
      .select({
        teamId: teams.id,
        teamName: teams.name,
        count: requestCount,
      })
      .from(teams)
      .innerJoin(teamMembers, eq(teamMembers.teamId, teams.id))
      .innerJoin(teamJoinRequests, eq(teamJoinRequests.teamId, teams.id))
      .where(
        and(
          isNull(teams.deletedAt),
          eq(teamMembers.userId, me),
          eq(teamMembers.role, "admin"),
          eq(teamJoinRequests.status, "pending"),
        ),
      )
      .groupBy(teams.id, teams.name)
      .orderBy(desc(requestCount), asc(teams.name), asc(teams.id)),
    database
      .select({
        teamInvites: sql<number>`(select count(*)::int from team_invites invitation
          join teams invited_team on invited_team.id = invitation.team_id
          where invitation.email = users.email and users.email_verified
            and invitation.accepted_at is null and invitation.declined_at is null
            and invitation.revoked_at is null and invitation.expires_at > ${now.toISOString()}::timestamptz
            and invited_team.deleted_at is null)`,
        friendRequests: receivedFriendRequestCount(me),
        messageRequests: messageRequestCount(me),
      })
      .from(users)
      .where(eq(users.id, me)),
    database
      .select({
        count: sql<number>`count(*) over()::int`,
        code: chatSpaceInvites.code,
      })
      .from(chatSpaceInvites)
      .innerJoin(chatSpaces, eq(chatSpaces.id, chatSpaceInvites.spaceId))
      .where(
        and(
          eq(chatSpaceInvites.targetUserId, me),
          eq(chatSpaces.kind, "community"),
          isNull(chatSpaces.deletedAt),
          usableInvite(now),
          sql`not exists (select 1 from chat_space_members member
            where member.space_id = ${chatSpaces.id} and member.user_id = ${me}::uuid
              and member.status in ('active', 'banned'))`,
        ),
      )
      .orderBy(desc(chatSpaceInvites.createdAt), asc(chatSpaceInvites.id))
      .limit(1),
  ]);
  if (!counts) return null;
  return {
    joinRequests: {
      top: joinRequests[0] ?? null,
      rest: joinRequests.slice(1).reduce((sum, row) => sum + row.count, 0),
    },
    ...counts,
    spaceInvites: {
      count: invite?.count ?? 0,
      href: invite ? `/s/join/${invite.code}` : null,
    },
  };
}

export async function readHomeChecklist(
  me: string,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({
      dismissedAt: users.homeChecklistDismissedAt,
      isOperator: sql<boolean>`exists (select 1 from branch_staff staff where staff.user_id = ${me}::uuid)`,
      username: sql<boolean>`${users.username} is not null`,
      team: sql<boolean>`exists (select 1 from team_members member
        join teams team on team.id = member.team_id
        where member.user_id = ${me}::uuid and team.deleted_at is null)`,
      booking: sql<boolean>`exists (select 1 from bookings booking where booking.user_id = ${me}::uuid)`,
      friend: sql<boolean>`exists (select 1 from friendships friend
        where ${me}::uuid in (friend.user_low_id, friend.user_high_id) and friend.status = 'accepted')`,
    })
    .from(users)
    .where(eq(users.id, me));
  return row ?? null;
}

export async function dismissHomeChecklist(
  me: string,
  now: Date,
  database: DalDatabase = getDb(),
) {
  await database
    .update(users)
    .set({ homeChecklistDismissedAt: now, updatedAt: sql`${users.updatedAt}` })
    .where(and(eq(users.id, me), isNull(users.homeChecklistDismissedAt)));
}
