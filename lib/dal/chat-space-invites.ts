import "server-only";
import { avatarColumns } from "./avatar";
import { toAvatar } from "@/lib/avatar";

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { ActionError } from "@/lib/actions/result";
import { getDb } from "@/lib/db/client";
import {
  chatSpaceInvites,
  chatSpaceMembers,
  chatSpaces,
  notifications,
  users,
} from "@/lib/db/schema";
import {
  activeSpaceMembership,
  readableSpaceCondition,
  sharedMembershipSpace,
} from "./chat-access";
import { sharedTeamCondition } from "./people-read";
import { blockedBetween } from "./people-blocks";
import { visibleNotificationWindow } from "./notifications-read";
import { requireSpaceJoinCapacity } from "./chat-space-write";
import type { DalDatabase } from "./database";

export function usableInvite(now: Date) {
  return and(
    isNull(chatSpaceInvites.revokedAt),
    or(isNull(chatSpaceInvites.expiresAt), gt(chatSpaceInvites.expiresAt, now)),
    sql`(${chatSpaceInvites.maxUses} is null or ${chatSpaceInvites.useCount} < ${chatSpaceInvites.maxUses})`,
  )!;
}
function communityVisible(me: string, spaceId: string) {
  return and(
    eq(chatSpaces.id, spaceId),
    eq(chatSpaces.kind, "community"),
    readableSpaceCondition(me),
  )!;
}
function inviteEligible(me: string, other: SQL) {
  return sql<boolean>`(exists (select 1 from friendships f where f.user_low_id = least(${me}::uuid, ${other}) and f.user_high_id = greatest(${me}::uuid, ${other}) and f.status = 'accepted') or ${sharedTeamCondition(me, other)} or ${sharedMembershipSpace(me, other)})`;
}
function unreadInvite(me: SQL, spaceId: string, now: Date) {
  return sql<boolean>`exists (select 1 from notifications n join chat_space_invites invitation on invitation.code = n.data->>'inviteCode'
    where n.user_id = ${me} and n.type = 'space_invite' and n.read_at is null
      and ${visibleNotificationWindow(now, sql`n.scheduled_for`, sql`n.expires_at`)} and invitation.space_id = ${spaceId}::uuid)`;
}

export async function readInviteResolution(
  code: string,
  me: string,
  now: Date,
  database: DalDatabase = getDb(),
) {
  const member = activeSpaceMembership(me);
  const valid = sql<boolean>`(${usableInvite(now)} and (${chatSpaceInvites.targetUserId} is null or ${chatSpaceInvites.targetUserId} = ${me}::uuid)
    and not exists (select 1 from chat_space_members m where m.space_id = ${chatSpaces.id} and m.user_id = ${me}::uuid and m.status = 'banned'))`;
  const [row] = await database
    .select({
      invite: chatSpaceInvites,
      spaceId: chatSpaces.id,
      spaceName: chatSpaces.name,
      iconColor: chatSpaces.iconColor,
      member,
      memberCount: sql<number>`(select count(*)::integer from chat_space_members m where m.space_id = ${chatSpaces.id} and ${activeSpaceMembership(sql`m.user_id`)})`,
    })
    .from(chatSpaceInvites)
    .innerJoin(chatSpaces, eq(chatSpaces.id, chatSpaceInvites.spaceId))
    .where(
      and(
        eq(chatSpaceInvites.code, code),
        eq(chatSpaces.kind, "community"),
        isNull(chatSpaces.deletedAt),
        or(member, valid),
      ),
    );
  return row ?? null;
}

export async function getInviteTarget(inviteId: string, database: DalDatabase) {
  const [row] = await database
    .select({ spaceId: chatSpaceInvites.spaceId })
    .from(chatSpaceInvites)
    .where(eq(chatSpaceInvites.id, inviteId));
  return row ?? null;
}
export async function getInviteCodeTarget(code: string, database: DalDatabase) {
  const [row] = await database
    .select({ spaceId: chatSpaceInvites.spaceId, id: chatSpaceInvites.id })
    .from(chatSpaceInvites)
    .where(eq(chatSpaceInvites.code, code));
  return row ?? null;
}
export async function lockInvite(inviteId: string, database: DalDatabase) {
  const [invite] = await database
    .select()
    .from(chatSpaceInvites)
    .where(eq(chatSpaceInvites.id, inviteId))
    .for("update");
  if (!invite) throw new ActionError("INVITE_INVALID");
  return invite;
}
export async function lockSpaceForInvite(
  spaceId: string,
  me: string,
  database: DalDatabase,
) {
  const [space] = await database
    .select()
    .from(chatSpaces)
    .where(
      and(
        eq(chatSpaces.id, spaceId),
        eq(chatSpaces.kind, "community"),
        isNull(chatSpaces.deletedAt),
      ),
    )
    .for("update");
  if (!space) throw new ActionError("INVITE_INVALID");
  await database
    .select({ userId: chatSpaceMembers.userId })
    .from(chatSpaceMembers)
    .where(
      and(
        eq(chatSpaceMembers.spaceId, spaceId),
        eq(chatSpaceMembers.userId, me),
      ),
    )
    .for("update");
  return space;
}
export async function countRecentInvites(
  me: string,
  now: Date,
  database: DalDatabase,
  spaceId?: string,
) {
  const [row] = await database
    .select({ count: count() })
    .from(chatSpaceInvites)
    .where(
      and(
        eq(chatSpaceInvites.createdBy, me),
        gt(chatSpaceInvites.createdAt, new Date(now.getTime() - 86_400_000)),
        spaceId
          ? and(
              eq(chatSpaceInvites.spaceId, spaceId),
              isNull(chatSpaceInvites.targetUserId),
            )
          : sql`${chatSpaceInvites.targetUserId} is not null`,
      ),
    );
  return row?.count ?? 0;
}
export async function insertSpaceInvites(
  rows: (typeof chatSpaceInvites.$inferInsert)[],
  database: DalDatabase,
) {
  if (!rows.length) return [];
  const inserted = await database
    .insert(chatSpaceInvites)
    .values(rows)
    .onConflictDoNothing({ target: chatSpaceInvites.code })
    .returning();
  if (inserted.length !== rows.length) throw new ActionError("INTERNAL");
  return inserted;
}
export async function deleteInviteNotifications(
  codes: readonly string[],
  database: DalDatabase,
  userId?: string,
) {
  if (!codes.length) return [];
  return database
    .delete(notifications)
    .where(
      and(
        eq(notifications.type, "space_invite"),
        inArray(sql`${notifications.data}->>'inviteCode'`, [...codes]),
        userId ? eq(notifications.userId, userId) : undefined,
      ),
    )
    .returning({ userId: notifications.userId });
}
export async function revokeSpaceInvite(
  inviteId: string,
  now: Date,
  database: DalDatabase,
) {
  return database
    .update(chatSpaceInvites)
    .set({ revokedAt: now })
    .where(
      and(
        eq(chatSpaceInvites.id, inviteId),
        isNull(chatSpaceInvites.revokedAt),
      ),
    )
    .returning({ id: chatSpaceInvites.id });
}
export async function joinInvitedSpace(
  inviteId: string,
  spaceId: string,
  userId: string,
  now: Date,
  database: DalDatabase,
) {
  const [capacity] = await database
    .select({ count: count() })
    .from(chatSpaceMembers)
    .where(
      and(
        eq(chatSpaceMembers.spaceId, spaceId),
        activeSpaceMembership(
          sql`${chatSpaceMembers.userId}`,
          sql`${chatSpaceMembers.spaceId}`,
        ),
      ),
    );
  if ((capacity?.count ?? 0) >= 200)
    throw new ActionError("LIMIT_EXCEEDED", { message: "space_full" });
  await requireSpaceJoinCapacity(userId, database);
  await database.insert(chatSpaceMembers).values({
    spaceId,
    userId,
    role: "member",
    status: "active",
    joinedAt: now,
    statusChangedAt: now,
    createdAt: now,
  });
  const [used] = await database
    .update(chatSpaceInvites)
    .set({ useCount: sql`${chatSpaceInvites.useCount} + 1` })
    .where(and(eq(chatSpaceInvites.id, inviteId), usableInvite(now)))
    .returning({ code: chatSpaceInvites.code });
  if (!used) throw new ActionError("INVITE_INVALID");
  return (
    (await deleteInviteNotifications([used.code], database, userId)).length > 0
  );
}
export function readDirectInviteTargets(
  spaceId: string,
  me: string,
  ids: string[],
  now: Date,
  database: DalDatabase,
) {
  return database
    .select({
      userId: users.id,
      eligible: inviteEligible(me, sql`${users.id}`),
      skip: sql<boolean>`(${blockedBetween(sql`${me}::uuid`, sql`${users.id}`)} or exists (select 1 from chat_space_members m where m.space_id = ${spaceId}::uuid and m.user_id = ${users.id} and (m.status = 'banned' or ${activeSpaceMembership(sql`${users.id}`, sql`${spaceId}::uuid`)})) or ${unreadInvite(sql`${users.id}`, spaceId, now)})`,
    })
    .from(users)
    .where(inArray(users.id, ids));
}
export function readReusableInvites(
  spaceId: string,
  ids: string[],
  now: Date,
  database: DalDatabase,
) {
  if (!ids.length) return Promise.resolve([]);
  return database
    .select()
    .from(chatSpaceInvites)
    .where(
      and(
        eq(chatSpaceInvites.spaceId, spaceId),
        inArray(chatSpaceInvites.targetUserId, ids),
        usableInvite(now),
      ),
    )
    .orderBy(desc(chatSpaceInvites.createdAt), asc(chatSpaceInvites.id))
    .for("update");
}
export function insertInviteNotifications(
  rows: (typeof notifications.$inferInsert)[],
  database: DalDatabase,
) {
  return database.insert(notifications).values(rows);
}

export async function listSpaceInvites(
  spaceId: string,
  me: string,
  now: Date,
  database: DalDatabase = getDb(),
) {
  const rows = await database
    .select({
      inviteId: chatSpaceInvites.id,
      codePrefix: sql<string>`left(${chatSpaceInvites.code}, 6)`,
      code: sql<
        string | null
      >`case when ${chatSpaceInvites.createdBy} = ${me}::uuid then ${chatSpaceInvites.code} else null end`,
      createdByName: users.name,
      createdByAvatar: avatarColumns(users),
      expiresAt: chatSpaceInvites.expiresAt,
      useCount: chatSpaceInvites.useCount,
      maxUses: chatSpaceInvites.maxUses,
    })
    .from(chatSpaceInvites)
    .innerJoin(chatSpaces, eq(chatSpaces.id, chatSpaceInvites.spaceId))
    .innerJoin(users, eq(users.id, chatSpaceInvites.createdBy))
    .where(
      and(
        communityVisible(me, spaceId),
        isNull(chatSpaceInvites.targetUserId),
        usableInvite(now),
        or(
          eq(chatSpaceInvites.createdBy, me),
          sql`exists (select 1 from chat_space_members m where m.space_id = ${chatSpaces.id} and m.user_id = ${me}::uuid and m.role in ('owner', 'admin') and ${activeSpaceMembership(me)})`,
        ),
      ),
    )
    .orderBy(desc(chatSpaceInvites.createdAt), asc(chatSpaceInvites.id));
  return rows.map((row) => ({
    ...row,
    createdByAvatar: toAvatar(row.createdByAvatar),
  }));
}
export async function listInviteCandidates(
  spaceId: string,
  me: string,
  database: DalDatabase = getDb(),
) {
  const rows = await database
    .select({
      userId: users.id,
      name: users.name,
      username: users.username,
      avatar: avatarColumns(users),
    })
    .from(users)
    .where(
      and(
        ne(users.id, me),
        inviteEligible(me, sql`${users.id}`),
        sql`not ${blockedBetween(sql`${me}::uuid`, sql`${users.id}`)}`,
        sql`not exists (select 1 from chat_space_members m where m.space_id = ${spaceId}::uuid and m.user_id = ${users.id} and (m.status = 'banned' or ${activeSpaceMembership(sql`${users.id}`, sql`${spaceId}::uuid`)}))`,
        sql`exists (select 1 from chat_spaces where ${communityVisible(me, spaceId)})`,
      ),
    )
    .orderBy(asc(users.name), asc(users.id))
    .limit(500);
  return rows.map((row) => ({ ...row, avatar: toAvatar(row.avatar) }));
}
