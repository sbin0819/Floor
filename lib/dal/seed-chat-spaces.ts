import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  chatRoomReads,
  chatRooms,
  chatSpaceInvites,
  chatSpaceMembers,
  chatSpacePrefs,
  chatSpaces,
  messages,
  notifications,
} from "@/lib/db/schema";
import type { SeedSpacesData } from "@/lib/seed/spaces";
import { SeedError } from "@/lib/seed/errors";
import { createBranchLounge } from "./chat-write";
import type { DalDatabase } from "./database";

type SeedMessage = { authorKey: string; body: string; minutesAgo: number };

export async function syncSeedChatSpaces(
  data: SeedSpacesData,
  branchIds: readonly string[],
  userIds: ReadonlyMap<string, string>,
  now: Date,
  database: DalDatabase,
  { newLoungesOnly = false }: { newLoungesOnly?: boolean } = {},
) {
  if (newLoungesOnly && data.communities.length)
    throw new SeedError("신규 지점 시드는 커뮤니티를 바꿀 수 없어요.");
  const userId = (key: string) => {
    const id = userIds.get(key);
    if (!id)
      throw new SeedError("스페이스 시드의 사용자 참조를 찾을 수 없어요.");
    return id;
  };
  const instant = (minutesAgo: number, offset = 0) => {
    const value = new Date(now.getTime() - minutesAgo * 60_000 + offset);
    if (!Number.isFinite(value.getTime()))
      throw new SeedError("스페이스 시드의 시각이 올바르지 않아요.");
    return value;
  };
  const joinedAt = (key: string, entries: readonly SeedMessage[]) => {
    const first = entries
      .filter(({ authorKey }) => authorKey === key)
      .reduce<number | null>(
        (minutes, entry) => Math.max(minutes ?? 0, entry.minutesAgo),
        null,
      );
    return first === null ? now : instant(first, -1);
  };
  // DB를 바꾸기 전에 주입한 계정과 모든 시각도 확인한다.
  for (const entry of data.loungeMembers)
    for (const key of entry.userKeys) userId(key);
  for (const community of data.communities) {
    for (const key of [
      community.ownerKey,
      ...community.adminKeys,
      ...community.memberKeys,
    ])
      userId(key);
    for (const entry of community.messages) instant(entry.minutesAgo, -1);
  }
  for (const entry of data.loungeMessages) instant(entry.minutesAgo, -1);

  let chatMessages = 0;
  let spaceMembers = 0;
  async function writeMessages(
    roomId: string,
    entries: readonly SeedMessage[],
    baseSeq = 0,
  ) {
    const rows = entries.map((entry, index) => ({
      roomId,
      authorId: userId(entry.authorKey),
      kind: "text" as const,
      body: entry.body,
      seq: baseSeq + index + 1,
      createdAt: instant(entry.minutesAgo),
    }));
    if (rows.length) await database.insert(messages).values(rows);
    const [last] = await database
      .select({
        seq: sql<number>`coalesce(max(${messages.seq}), 0)::double precision`,
        at: sql<Date | null>`max(${messages.createdAt})`.mapWith(
          messages.createdAt,
        ),
      })
      .from(messages)
      .where(eq(messages.roomId, roomId));
    await database
      .update(chatRooms)
      .set({
        lastSeq: Math.max(baseSeq, last?.seq ?? 0),
        lastMessageAt: last?.at ?? null,
      })
      .where(eq(chatRooms.id, roomId));
    const lastByAuthor = new Map(rows.map((row) => [row.authorId, row]));
    if (lastByAuthor.size)
      await database.insert(chatRoomReads).values(
        [...lastByAuthor].map(([authorId, row]) => ({
          roomId,
          userId: authorId,
          lastReadSeq: row.seq,
          updatedAt: now,
          createdAt: row.createdAt,
        })),
      );
    chatMessages += rows.length;
  }

  const seedUserIds = [...userIds.values()];
  for (const branchId of branchIds) {
    const { spaceId } = await createBranchLounge(branchId, database);
    const rooms = await database
      .select({ id: chatRooms.id, name: chatRooms.name })
      .from(chatRooms)
      .where(and(eq(chatRooms.spaceId, spaceId), eq(chatRooms.kind, "text")))
      .orderBy(asc(chatRooms.createdAt), asc(chatRooms.id));
    const roomIds = rooms.map(({ id }) => id);
    if (!newLoungesOnly && seedUserIds.length) {
      await database
        .delete(chatSpaceMembers)
        .where(
          and(
            eq(chatSpaceMembers.spaceId, spaceId),
            inArray(chatSpaceMembers.userId, seedUserIds),
          ),
        );
      if (roomIds.length) {
        await database
          .delete(messages)
          .where(
            and(
              inArray(messages.roomId, roomIds),
              inArray(messages.authorId, seedUserIds),
            ),
          );
        await database
          .delete(chatRoomReads)
          .where(
            and(
              inArray(chatRoomReads.roomId, roomIds),
              inArray(chatRoomReads.userId, seedUserIds),
            ),
          );
      }
    }
    const entries = data.loungeMessages.filter(
      (row) => row.branchId === branchId,
    );
    const memberKeys =
      data.loungeMembers.find((row) => row.branchId === branchId)?.userKeys ??
      [];
    if (memberKeys.length)
      await database.insert(chatSpaceMembers).values(
        memberKeys.map((key) => ({
          spaceId,
          userId: userId(key),
          role: "member" as const,
          status: "active" as const,
          joinedAt: joinedAt(key, entries),
          statusChangedAt: joinedAt(key, entries),
          createdAt: joinedAt(key, entries),
        })),
      );
    spaceMembers += memberKeys.length;
    const lounge = rooms.find(({ name }) => name === "라운지");
    if (entries.length && !lounge)
      throw new SeedError(
        "시드 라운지의 기본 채널이 없어요. 채널을 되살리지 않았어요.",
      );
    for (const room of rooms) {
      const roomEntries = room.id === lounge?.id ? entries : [];
      if (newLoungesOnly && !roomEntries.length) continue;
      // 비시드 대화와 읽은 번호는 재번호를 매기지 않고 그대로 둔다.
      const [base] = await database
        .select({
          seq: sql<number>`greatest(
        coalesce((select max(m.seq) from messages m where m.room_id = ${room.id}), 0),
        coalesce((select max(r.last_read_seq) from chat_room_reads r where r.room_id = ${room.id}), 0)
      )::double precision`,
        })
        .from(sql`(select 1) as seed_cursor`);
      await writeMessages(room.id, roomEntries, base?.seq ?? 0);
    }
  }

  for (const community of data.communities) {
    const [existing] = await database
      .select({ kind: chatSpaces.kind })
      .from(chatSpaces)
      .where(eq(chatSpaces.id, community.id));
    if (existing && existing.kind !== "community")
      throw new SeedError(
        "시드 커뮤니티의 고정 ID를 다른 종류가 사용하고 있어요.",
      );
    const inviteCodes = database
      .select({ code: chatSpaceInvites.code })
      .from(chatSpaceInvites)
      .where(eq(chatSpaceInvites.spaceId, community.id));
    await database
      .delete(notifications)
      .where(
        and(
          eq(notifications.type, "space_invite"),
          sql`${notifications.data}->>'inviteCode' in (${inviteCodes})`,
        ),
      );
    await database
      .delete(chatSpaceInvites)
      .where(eq(chatSpaceInvites.spaceId, community.id));
    await database
      .delete(chatSpaceMembers)
      .where(eq(chatSpaceMembers.spaceId, community.id));
    // 방 삭제가 읽음·메시지·멘션·리액션을 같은 트랜잭션에서 함께 지운다.
    await database.delete(chatRooms).where(eq(chatRooms.spaceId, community.id));
    await database
      .delete(chatSpacePrefs)
      .where(eq(chatSpacePrefs.spaceId, community.id));
    await database.delete(chatSpaces).where(eq(chatSpaces.id, community.id));
    const createdAt = instant(
      Math.max(0, ...community.messages.map(({ minutesAgo }) => minutesAgo)),
      -1,
    );
    await database.insert(chatSpaces).values({
      id: community.id,
      kind: "community",
      name: community.name,
      iconColor: community.iconColor,
      createdBy: userId(community.ownerKey),
      createdAt,
    });
    const memberRows = [
      { key: community.ownerKey, role: "owner" as const },
      ...community.adminKeys.map((key) => ({ key, role: "admin" as const })),
      ...community.memberKeys.map((key) => ({ key, role: "member" as const })),
    ];
    await database.insert(chatSpaceMembers).values(
      memberRows.map(({ key, role }) => ({
        spaceId: community.id,
        userId: userId(key),
        role,
        status: "active" as const,
        joinedAt: joinedAt(key, community.messages),
        statusChangedAt: joinedAt(key, community.messages),
        createdAt: joinedAt(key, community.messages),
      })),
    );
    spaceMembers += memberRows.length;
    await database.insert(chatRooms).values(
      community.channels.map((channel) => ({
        ...channel,
        kind: "text" as const,
        spaceId: community.id,
        createdAt,
      })),
    );
    for (const room of community.channels)
      await writeMessages(
        room.id,
        community.messages.filter(({ channel }) => channel === room.name),
      );
  }
  return {
    communitySpaces: data.communities.length,
    spaceMembers,
    chatMessages,
  };
}
