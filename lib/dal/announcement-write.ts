import "server-only";

import { and, count, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { announcements, chatRooms } from "@/lib/db/schema";
import type { AnnouncementAudience } from "@/features/admin/announcement-types";
import type { DalDatabase } from "./database";

export async function lockAnnouncementBranch(
  branchId: string,
  db: DalDatabase,
) {
  await db
    .select({
      locked: sql`pg_advisory_xact_lock(hashtextextended(${"announcement:" + branchId}::text, 0))`,
    })
    .from(sql`(values (1)) as announcement_lock(value)`);
}

export async function countDailyAnnouncements(
  { branchId, start, end }: { branchId: string; start: Date; end: Date },
  db: DalDatabase,
) {
  const [row] = await db
    .select({ count: count() })
    .from(announcements)
    .where(
      and(
        eq(announcements.branchId, branchId),
        gte(announcements.createdAt, start),
        lt(announcements.createdAt, end),
      ),
    );
  return row?.count ?? 0;
}

export async function lockAnnouncementUsers(
  operatorId: string,
  recipientIds: readonly string[],
  db: DalDatabase,
) {
  const ids = [
    ...new Set([operatorId, ...recipientIds].map((id) => id.toLowerCase())),
  ].sort();
  const values = sql.join(
    ids.map((id) => sql`${id}::uuid`),
    sql`, `,
  );
  // 잠금 표현식은 정렬 키에 넣지 않는다. 정렬 뒤 각 행의 CASE만 평가하여
  // 강도별 두 묶음 잠금이나 방 잠금 이후 승격 없이 UUID 순서를 유지한다.
  const rows = await db
    .select({
      id: sql<string>`locked_users.id`,
      lockedId: sql<string | null>`locked_users.locked_id`,
    })
    .from(
      sql`(
    with requested as materialized (
      select id from unnest(array[${values}]) as requested_id(id) order by id
    )
    select requested.id,
      case when requested.id = ${operatorId.toLowerCase()}::uuid
        then (select u.id from users u where u.id = requested.id for update)
        else (select u.id from users u where u.id = requested.id for key share)
      end as locked_id
    from requested order by requested.id
  ) as locked_users`,
    )
    .orderBy(sql`locked_users.id`);
  return (
    rows.length === ids.length && rows.every((row) => row.id === row.lockedId)
  );
}

export async function lockAnnouncementRoom(
  roomId: string,
  spaceId: string,
  db: DalDatabase,
) {
  const [room] = await db
    .select({ id: chatRooms.id })
    .from(chatRooms)
    .where(
      and(
        eq(chatRooms.id, roomId),
        eq(chatRooms.spaceId, spaceId),
        eq(chatRooms.kind, "text"),
        eq(chatRooms.name, "공지"),
        eq(chatRooms.adminOnly, true),
        isNull(chatRooms.archivedAt),
      ),
    )
    .for("update");
  return room ?? null;
}

export async function insertAnnouncement(
  input: {
    id: string;
    branchId: string;
    authorId: string;
    title: string;
    body: string;
    loungeMessageId: string | null;
    audience: AnnouncementAudience | null;
    recipientCount: number;
    now: Date;
  },
  db: DalDatabase,
) {
  const { now, ...values } = input;
  await db.insert(announcements).values({ ...values, createdAt: now });
}
