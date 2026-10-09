import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { chatSpaces, users } from "@/lib/db/schema";
import { alias } from "drizzle-orm/pg-core";
import { avatarJson } from "./avatar";
import { toAvatar, type Avatar, type AvatarSource } from "@/lib/avatar";
import {
  chatSpaceName,
  isSpaceAdmin,
  loungeAccessFrom,
  readableSpaceCondition,
  sharesChatSpace,
  spaceAccessFields,
  spaceRoleFrom,
  type SpaceRole,
} from "./chat-access";
import type { DalDatabase } from "./database";

type MemberRow = {
  userId: string;
  name: string;
  username: string | null;
  role: SpaceRole;
  sharesSpace: boolean;
  status: "active" | "banned";
  avatar: AvatarSource;
};
export type SpaceMember = Omit<MemberRow, "status" | "avatar"> & {
  avatar: Avatar;
};

export async function readSpaceMembers(
  userId: string,
  spaceId: string,
  database: DalDatabase = getDb(),
) {
  const access = spaceAccessFields(userId);
  const [space] = await database
    .select({
      id: chatSpaces.id,
      kind: chatSpaces.kind,
      branchId: chatSpaces.branchId,
      iconColor: chatSpaces.iconColor,
      name: chatSpaceName,
      ...access,
      memberCount: sql<number>`case when ${chatSpaces}.kind = 'team'
      then (select count(*)::int from team_members where team_id = ${chatSpaces}.team_id)
      else (select count(*)::int from chat_space_members where space_id = ${chatSpaces}.id and status = 'active') end`,
      people: sql<
        MemberRow[] | null
      >`case when ${chatSpaces}.kind = 'branch' then null
      else coalesce((select jsonb_agg(to_jsonb(person) - 'position' order by
        case person.status when 'active' then 0 else 1 end, person.position) from (
        select u.id as "userId", u.name, u.username, member.role, member.status,
          ${avatarJson(alias(users, "u"))} as avatar,
          ${sharesChatSpace(userId, sql`u.id`)} as "sharesSpace",
          row_number() over (partition by member.status order by
            case member.role when 'owner' then 0 when 'admin' then 1 else 2 end,
            u.name, u.id) as position
        from users u join (
          select user_id, role::text as role, 'active'::text as status from team_members
            where ${chatSpaces}.kind = 'team' and team_id = ${chatSpaces}.team_id
          union all
          select user_id, role::text, status::text from chat_space_members
            where ${chatSpaces}.kind = 'community' and space_id = ${chatSpaces}.id
              and (status = 'active' or ${access.memberRole} in ('owner', 'admin'))
        ) member on member.user_id = u.id
      ) person where person.position <= 200), '[]'::jsonb) end`,
    })
    .from(chatSpaces)
    .where(and(eq(chatSpaces.id, spaceId), readableSpaceCondition(userId)));
  if (!space) return null;
  const role = spaceRoleFrom(space);
  if (!role) return null;
  return {
    ...space,
    role,
    people:
      space.people?.map((person) => ({
        ...person,
        avatar: toAvatar(person.avatar),
      })) ?? null,
  };
}

export async function readLoungeMembers(
  userId: string,
  space: NonNullable<Awaited<ReturnType<typeof readSpaceMembers>>>,
  database: DalDatabase = getDb(),
) {
  const regularAdmin = loungeAccessFrom({
    isStaff: false,
    roleSettings: space.roleSettings,
  }).isAdmin;
  const staffAdmin = loungeAccessFrom({
    isStaff: true,
    roleSettings: space.roleSettings,
  }).isAdmin;
  const admin = sql<boolean>`(${regularAdmin} or (${staffAdmin} and exists (
    select 1 from branch_staff staff where staff.branch_id = ${space.branchId}::uuid and staff.user_id = u.id)))`;
  const currentAccess = spaceAccessFields(userId);
  const [result] = await database
    .select({
      people: sql<
        MemberRow[]
      >`coalesce((select jsonb_agg(to_jsonb(person) - 'position' order by person.status, person.position) from (
      select u.id as "userId", u.name, u.username,
        ${avatarJson(alias(users, "u"))} as avatar,
        case when ${admin} then 'admin' else 'member' end as role,
        member.status,
        ${sharesChatSpace(userId, sql`u.id`)} as "sharesSpace",
        row_number() over (partition by member.status order by ${admin} desc, u.name, u.id) as position
      from chat_space_members member join users u on u.id = member.user_id
      where member.space_id = ${chatSpaces}.id
        and (${isSpaceAdmin(space.role)} or (member.status = 'active' and ${admin}))
    ) person where person.position <= 200), '[]'::jsonb)`,
    })
    .from(chatSpaces)
    .where(
      and(
        eq(chatSpaces.id, space.id),
        readableSpaceCondition(userId),
        // 두 조회 사이 권한이 바뀌었다면 이전 판정으로 명부를 읽지 않는다.
        sql`${currentAccess.isStaff} = ${space.isStaff}`,
        sql`${currentAccess.roleSettings} = ${JSON.stringify(space.roleSettings)}::jsonb`,
      ),
    );
  return (
    result?.people.map((person) => ({
      ...person,
      avatar: toAvatar(person.avatar),
    })) ?? null
  );
}
