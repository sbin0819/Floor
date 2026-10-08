import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { chatSpaces } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import {
  readableSpaceCondition,
  spaceAccessFields,
  spaceRoleFrom,
} from "./chat-access";
import type { DalDatabase } from "./database";

export async function readSpaceSettings(
  userId: string,
  spaceId: string,
  database: DalDatabase = getDb(),
) {
  const [space] = await database
    .select({
      id: chatSpaces.id,
      kind: chatSpaces.kind,
      iconColor: chatSpaces.iconColor,
      name: sql<string>`case when ${chatSpaces}.kind = 'team' then (select name from teams where id = ${chatSpaces}.team_id) when ${chatSpaces}.kind = 'branch' then (select name from branches where id = ${chatSpaces}.branch_id) else ${chatSpaces}.name end`,
      ...spaceAccessFields(userId),
      channels: sql<
        { id: string; name: string; topic: string | null; adminOnly: boolean }[]
      >`coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'topic', r.topic, 'adminOnly', r.admin_only) order by r.created_at, r.id) from chat_rooms r where r.space_id = ${chatSpaces}.id and r.kind = 'text' and r.archived_at is null), '[]'::jsonb)`,
    })
    .from(chatSpaces)
    .where(and(eq(chatSpaces.id, spaceId), readableSpaceCondition(userId)));
  if (!space) return null;
  const role = spaceRoleFrom(space);
  if (!role) return null;
  return {
    id: space.id,
    kind: space.kind,
    name: space.name,
    iconColor: space.iconColor,
    role,
    channels: space.channels,
  };
}
