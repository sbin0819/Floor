import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";
import { systemMessageText } from "@/features/chat/system-messages";
import {
  chatRoomMembers,
  chatRoomReads,
  chatRooms,
  messages,
  notifications,
  reports,
  userBlocks,
  users,
} from "@/lib/db/schema";
import type { SeedPeople2Data } from "@/lib/seed/people-2";
import { SeedError } from "@/lib/seed/errors";
import type { DalDatabase } from "./database";

export async function syncSeedPeople2(
  people: SeedPeople2Data,
  userIds: ReadonlyMap<string, string>,
  now: Date,
  database: DalDatabase,
) {
  const ids = [...userIds.values()];
  if (!ids.length) return { groupRooms: 0, directRooms: 0, chatMessages: 0 };
  const userId = (key: string) => {
    const id = userIds.get(key);
    if (!id)
      throw new SeedError("사람 2차 시드의 사용자 참조를 찾을 수 없어요.");
    return id;
  };
  const instant = (minutesAgo: number) => {
    const date = new Date(now.getTime() - minutesAgo * 60_000);
    if (!Number.isFinite(date.getTime()))
      throw new SeedError("사람 2차 시드의 시각이 올바르지 않아요.");
    return date;
  };
  const names = new Map(
    (
      await database
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(inArray(users.id, ids))
    ).map(({ id, name }) => [id, name]),
  );
  if (names.size !== ids.length)
    throw new SeedError("사람 2차 시드 계정이 모두 준비되지 않았어요.");

  // 나간 멤버도 포함해 비시드 사용자가 한 명이라도 있으면 그 그룹은 보존한다.
  await database.delete(chatRooms).where(
    and(
      eq(chatRooms.kind, "group_dm"),
      sql`exists (select 1 from chat_room_members m where m.room_id = ${chatRooms.id})`,
      sql`not exists (select 1 from chat_room_members m where m.room_id = ${chatRooms.id} and m.user_id not in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )}))`,
    ),
  );
  await database
    .delete(notifications)
    .where(
      and(
        eq(notifications.type, "message_request"),
        inArray(notifications.userId, ids),
        inArray(notifications.actorId, ids),
      ),
    );
  await database.delete(userBlocks).where(inArray(userBlocks.blockerId, ids));
  await database.delete(reports).where(inArray(reports.reporterId, ids));
  await database
    .update(users)
    .set({ status: "online", updatedAt: sql`${users.updatedAt}` })
    .where(inArray(users.id, ids));
  for (const { userKey, status } of people.statuses)
    await database
      .update(users)
      .set({ status, updatedAt: sql`${users.updatedAt}` })
      .where(eq(users.id, userId(userKey)));

  let chatMessages = 0;
  async function writeMessages(
    roomId: string,
    rows: (typeof messages.$inferInsert & { createdAt: Date })[],
    systemActor?: string,
  ) {
    if (!rows.length) return;
    await database.insert(messages).values(rows);
    const last = rows.at(-1)!;
    await database
      .update(chatRooms)
      .set({ lastSeq: last.seq, lastMessageAt: last.createdAt })
      .where(eq(chatRooms.id, roomId));
    const lastByAuthor = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const author =
        row.authorId ?? (row.kind === "system" ? systemActor : undefined);
      if (author) lastByAuthor.set(author, row);
    }
    if (lastByAuthor.size)
      await database.insert(chatRoomReads).values(
        [...lastByAuthor].map(([userId, row]) => ({
          roomId,
          userId,
          lastReadSeq: row.seq,
          updatedAt: row.createdAt,
          createdAt: row.createdAt,
        })),
      );
    chatMessages += rows.length;
  }
  for (const group of people.groupDirectMessages) {
    const createdAt = instant(group.minutesAgo);
    const creator = userId(group.createdBy);
    const [room] = await database
      .insert(chatRooms)
      .values({ kind: "group_dm", name: group.name || null, createdAt })
      .returning({ id: chatRooms.id });
    if (!room) throw new SeedError("시드 그룹을 만들지 못했어요.");
    await database.insert(chatRoomMembers).values(
      group.members.map((key) => ({
        roomId: room.id,
        userId: userId(key),
        status: "active" as const,
        joinedAt: createdAt,
        statusChangedAt: createdAt,
        createdAt,
      })),
    );
    const systemData = {
      type: "group_created" as const,
      actorName: names.get(creator)!,
    };
    await writeMessages(
      room.id,
      [
        {
          roomId: room.id,
          seq: 1,
          kind: "system",
          authorId: null,
          systemData,
          body: systemMessageText(systemData),
          createdAt,
        },
        ...group.messages.map(({ authorKey, minutesAgo, body }, index) => ({
          roomId: room.id,
          seq: index + 2,
          authorId: userId(authorKey),
          body,
          createdAt: instant(minutesAgo),
        })),
      ],
      creator,
    );
  }
  for (const request of people.messageRequests) {
    const from = userId(request.from);
    const to = userId(request.to);
    const [low, high] = [from, to].sort();
    const first = request.messages[0];
    if (!first)
      throw new SeedError("시드 메시지 요청에는 첫 메시지가 있어야 해요.");
    const requestedAt = instant(first.minutesAgo);
    const [room] = await database
      .insert(chatRooms)
      .values({
        kind: "dm",
        dmLowUserId: low!,
        dmHighUserId: high!,
        createdAt: requestedAt,
      })
      .returning({ id: chatRooms.id });
    if (!room) throw new SeedError("시드 메시지 요청을 만들지 못했어요.");
    await database.insert(chatRoomMembers).values([
      {
        roomId: room.id,
        userId: from,
        status: "active",
        joinedAt: requestedAt,
        statusChangedAt: requestedAt,
        createdAt: requestedAt,
      },
      {
        roomId: room.id,
        userId: to,
        status: "requested",
        requestedAt,
        joinedAt: requestedAt,
        statusChangedAt: requestedAt,
        createdAt: requestedAt,
      },
    ]);
    await writeMessages(
      room.id,
      request.messages.map(({ minutesAgo, body }, index) => ({
        roomId: room.id,
        seq: index + 1,
        authorId: from,
        body,
        createdAt: instant(minutesAgo),
      })),
    );
    await database.insert(notifications).values({
      userId: to,
      actorId: from,
      type: "message_request",
      data: { actorName: names.get(from)! },
      scheduledFor: requestedAt,
    });
  }
  return {
    groupRooms: people.groupDirectMessages.length,
    directRooms: people.messageRequests.length,
    chatMessages,
  };
}
