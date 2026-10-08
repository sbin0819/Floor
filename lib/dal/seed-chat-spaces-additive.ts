import "server-only";

import {
  and,
  asc,
  eq,
  getTableColumns,
  inArray,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import {
  chatRoomReads,
  chatRooms,
  chatSpaceMembers,
  chatSpaces,
  messages,
  users,
} from "@/lib/db/schema";
import type { DalDatabase } from "./database";
import { SeedError } from "@/lib/seed/errors";
import { getDb } from "@/lib/db/client";
import { activeSpaceMembership } from "./chat-access";

export type ChatSpacesSeedReferences = {
  branchIds: string[];
  fixedIds: string[];
  userEmails: string[];
};

export async function prepareChatSpacesSeedDatabase(
  databaseName: string,
  database: DalDatabase,
) {
  const [row] = await database
    .select({ name: sql<string>`pg_catalog.current_database()` })
    .from(sql`(select 1) seed_target`);
  if (row?.name !== databaseName)
    throw new SeedError("스페이스 시드의 실제 DB 이름이 확인한 대상과 달라요.");
  // 같은 이름의 다른 스키마나 임시 테이블로 보호 대상이 바뀌지 않게 TX 안에서만 고정한다.
  await database
    .select({
      path: sql<string>`pg_catalog.set_config('search_path', 'pg_catalog, public, pg_temp', true)`,
    })
    .from(sql`(select 1) seed_path`);
}

export async function readChatSpacesSeedState(
  references: ChatSpacesSeedReferences,
  database: DalDatabase,
) {
  const [spaceRows, roomRows, messageRows, userRows] = await Promise.all([
    database
      .select({
        ...getTableColumns(chatSpaces),
        createdAtRaw: sql<string>`to_char(${chatSpaces.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(chatSpaces)
      .where(
        or(
          inArray(chatSpaces.branchId, references.branchIds),
          inArray(chatSpaces.id, references.fixedIds),
        ),
      ),
    database
      .select({
        ...getTableColumns(chatRooms),
        createdAtRaw: sql<string>`to_char(${chatRooms.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(chatRooms)
      .where(
        or(
          inArray(chatRooms.id, references.fixedIds),
          inArray(
            chatRooms.spaceId,
            database
              .select({ id: chatSpaces.id })
              .from(chatSpaces)
              .where(
                or(
                  inArray(chatSpaces.branchId, references.branchIds),
                  inArray(chatSpaces.id, references.fixedIds),
                ),
              ),
          ),
        ),
      ),
    database
      .select({
        id: messages.id,
        roomId: messages.roomId,
        seq: messages.seq,
        authorId: messages.authorId,
        kind: messages.kind,
        createdAt: messages.createdAt,
        clientId: messages.clientId,
        createdAtRaw: sql<string>`to_char(${messages.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(messages)
      .where(
        or(
          inArray(messages.id, references.fixedIds),
          inArray(messages.clientId, references.fixedIds),
        ),
      ),
    references.userEmails.length
      ? database
          .select({
            id: users.id,
            email: users.email,
            emailVerified: users.emailVerified,
          })
          .from(users)
          .where(inArray(users.email, references.userEmails))
      : Promise.resolve([]),
  ]);
  return { spaceRows, roomRows, messageRows, userRows };
}
export type ChatSpacesSeedState = Awaited<
  ReturnType<typeof readChatSpacesSeedState>
>;

export async function lockChatSpacesSeedTargets(
  userIds: readonly string[],
  lounge: { spaceId: string; roomId: string },
  database: DalDatabase,
) {
  await database
    .select({ id: users.id })
    .from(users)
    .where(inArray(users.id, [...userIds]))
    .orderBy(asc(users.id))
    .for("update");
  await database
    .select({ id: chatSpaces.id })
    .from(chatSpaces)
    .where(eq(chatSpaces.id, lounge.spaceId))
    .for("update");
  await database
    .select({ id: chatRooms.id })
    .from(chatRooms)
    .where(eq(chatRooms.id, lounge.roomId))
    .for("update");
}

export async function inspectChatSpacesSeedCapacity(
  userIds: readonly string[],
  spaceId: string,
  database: DalDatabase,
) {
  const [memberships, [pristine]] = await Promise.all([
    database
      .select({
        id: users.id,
        joined: sql<number>`(select count(*)::integer from chat_spaces existing where existing.kind in ('branch','community') and ${activeSpaceMembership(sql`${users}.id`, sql`existing.id`)})`,
        owned: sql<number>`(select count(*)::integer from chat_space_members member join chat_spaces existing on existing.id=member.space_id where member.user_id=${users}.id and member.role='owner' and member.status='active' and existing.kind='community' and existing.deleted_at is null)`,
      })
      .from(users)
      .where(inArray(users.id, [...userIds])),
    database
      .select({
        clear: sql<boolean>`not exists(select 1 from chat_space_members m where m.space_id=${spaceId}::uuid)
      and not exists(select 1 from chat_space_invites i where i.space_id=${spaceId}::uuid)
      and not exists(select 1 from chat_space_prefs p where p.space_id=${spaceId}::uuid)
      and not exists(select 1 from chat_rooms r where r.space_id=${spaceId}::uuid and (
        exists(select 1 from messages m where m.room_id=r.id)
        or exists(select 1 from chat_room_reads seen where seen.room_id=r.id)
        or exists(select 1 from chat_room_members member where member.room_id=r.id)
        or exists(select 1 from message_attachments attachment where attachment.room_id=r.id)
        or exists(select 1 from call_sessions call where call.room_id=r.id)))`,
      })
      .from(sql`(select 1) pristine_lounge`),
  ]);
  return { memberships, pristine: pristine?.clear === true };
}

export type ChatSpacesSeedBundle = {
  spaces: (typeof chatSpaces.$inferInsert)[];
  rooms: (typeof chatRooms.$inferInsert)[];
  members: (typeof chatSpaceMembers.$inferInsert)[];
  messages: (typeof messages.$inferInsert)[];
  reads: (typeof chatRoomReads.$inferInsert)[];
  lounge: { id: string; spaceId: string; lastSeq: number; lastMessageAt: Date };
};

export async function insertChatSpacesSeedBundle(
  bundle: ChatSpacesSeedBundle,
  database: DalDatabase,
) {
  await database.insert(chatSpaces).values(bundle.spaces);
  await database.insert(chatRooms).values(bundle.rooms);
  await database.insert(chatSpaceMembers).values(bundle.members);
  await database.insert(messages).values(bundle.messages);
  await database.insert(chatRoomReads).values(bundle.reads);
  const [updated] = await database
    .update(chatRooms)
    .set({
      lastSeq: bundle.lounge.lastSeq,
      lastMessageAt: bundle.lounge.lastMessageAt,
    })
    .where(
      and(
        eq(chatRooms.id, bundle.lounge.id),
        eq(chatRooms.spaceId, bundle.lounge.spaceId),
        eq(chatRooms.kind, "text"),
        eq(chatRooms.name, "라운지"),
        isNull(chatRooms.archivedAt),
        eq(chatRooms.lastSeq, 0),
        isNull(chatRooms.lastMessageAt),
      ),
    )
    .returning({ id: chatRooms.id });
  if (!updated)
    throw new SeedError(
      "라운지의 최초 메시지 조건이 바뀌어 스페이스 추가를 중단했어요.",
    );
}

/** 지시서 26 마이그레이션 이전에도 존재하는 식별 컬럼만 읽는 배포 사전 확인이다. */
export async function readChatSpacesPrerequisites(
  references: ChatSpacesSeedReferences,
  database: DalDatabase = getDb(),
) {
  const [branchRows, userRows, spaceRows, roomRows, messageRows] =
    await Promise.all([
      database
        .select({ id: sql<string>`id` })
        .from(sql`public.branches`)
        .where(
          sql`id in (${sql.join(
            references.branchIds.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})`,
        ),
      database
        .select({
          id: sql<string>`${users.id}`,
          email: sql<string>`${users.email}`,
          emailVerified: sql<boolean>`${users.emailVerified}`,
        })
        .from(sql`public.users`)
        .where(inArray(users.email, references.userEmails)),
      database
        .select({
          id: sql<string>`${chatSpaces.id}`,
          kind: sql<string>`${chatSpaces.kind}`,
        })
        .from(sql`public.chat_spaces`)
        .where(inArray(chatSpaces.id, references.fixedIds)),
      database
        .select({
          id: sql<string>`${chatRooms.id}`,
          spaceId: sql<string | null>`${chatRooms.spaceId}`,
          kind: sql<string>`${chatRooms.kind}`,
        })
        .from(sql`public.chat_rooms`)
        .where(inArray(chatRooms.id, references.fixedIds)),
      database
        .select({
          id: sql<string>`${messages.id}`,
          roomId: sql<string>`${messages.roomId}`,
          clientId: sql<string | null>`${messages.clientId}`,
        })
        .from(sql`public.messages`)
        .where(
          or(
            inArray(messages.id, references.fixedIds),
            inArray(messages.clientId, references.fixedIds),
          ),
        ),
    ]);
  return { branchRows, userRows, spaceRows, roomRows, messageRows };
}
