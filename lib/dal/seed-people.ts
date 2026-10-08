import "server-only";

import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  chatRoomMembers,
  chatRoomReads,
  chatRooms,
  friendships,
  messages,
  notifications,
  users,
} from "@/lib/db/schema";
import type { SeedPeopleData } from "@/lib/seed/people";
import { SeedError } from "@/lib/seed/errors";
import type { DalDatabase } from "./database";

export async function syncSeedPeople(
  people: SeedPeopleData,
  userIds: ReadonlyMap<string, string>,
  now: Date,
  database: DalDatabase,
): Promise<{ friendships: number; directRooms: number; chatMessages: number }> {
  const ids = [...userIds.values()];
  if (!ids.length) return { friendships: 0, directRooms: 0, chatMessages: 0 };
  const userId = (key: string) => {
    const id = userIds.get(key);
    if (!id) throw new SeedError("사람 시드의 사용자 참조를 찾을 수 없어요.");
    return id;
  };
  const instant = (minutesAgo: number) => {
    const date = new Date(now.getTime() - minutesAgo * 60_000);
    if (!Number.isFinite(date.getTime()))
      throw new SeedError("사람 시드의 시각이 올바르지 않아요.");
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
    throw new SeedError("사람 시드 계정이 모두 준비되지 않았어요.");
  const requestedNames = people.usernames.map(({ username }) => username);
  const conflicts = requestedNames.length
    ? await database
        .select({ username: users.username })
        .from(users)
        .where(
          and(
            inArray(users.username, requestedNames),
            notInArray(users.id, ids),
          ),
        )
    : [];
  if (conflicts.length)
    throw new SeedError(
      `사람 시드의 사용자 이름을 다른 사람이 쓰고 있어요: ${conflicts.map(({ username }) => username).join(", ")}`,
    );

  // 자기 계정들의 이름을 먼저 비워 서로 맞바꿔도 유일 제약에 걸리지 않는다. 변경 이력은 보존한다.
  await database
    .update(users)
    .set({ username: null, updatedAt: sql`${users.updatedAt}` })
    .where(inArray(users.id, ids));
  for (const { userKey, username } of people.usernames)
    await database
      .update(users)
      .set({ username, updatedAt: sql`${users.updatedAt}` })
      .where(eq(users.id, userId(userKey)));
  await database
    .delete(friendships)
    .where(
      and(
        inArray(friendships.userLowId, ids),
        inArray(friendships.userHighId, ids),
      ),
    );
  await database
    .delete(notifications)
    .where(
      and(
        inArray(notifications.type, ["friend_request", "friend_accepted"]),
        inArray(notifications.userId, ids),
        inArray(notifications.actorId, ids),
      ),
    );
  await database
    .delete(chatRooms)
    .where(
      and(
        eq(chatRooms.kind, "dm"),
        inArray(chatRooms.dmLowUserId, ids),
        inArray(chatRooms.dmHighUserId, ids),
      ),
    );

  for (const friendship of people.friendships) {
    const requestedBy = userId(friendship.requestedBy);
    const to = userId(friendship.to);
    const [userLowId, userHighId] = [requestedBy, to].sort();
    const requestedAt = instant(friendship.minutesAgo);
    await database.insert(friendships).values({
      userLowId: userLowId!,
      userHighId: userHighId!,
      requestedBy,
      status: friendship.status,
      requestedAt,
      statusChangedAt: requestedAt,
      createdAt: requestedAt,
    });
    if (friendship.status === "pending")
      await database.insert(notifications).values({
        userId: to,
        type: "friend_request",
        actorId: requestedBy,
        data: { actorName: names.get(requestedBy)! },
        scheduledFor: requestedAt,
      });
  }
  let chatMessages = 0;
  for (const direct of people.directMessages) {
    const ids = direct.users.map(userId).sort();
    const first = direct.messages[0];
    if (!first) throw new SeedError("시드 DM에는 첫 메시지가 있어야 해요.");
    const joinedAt = instant(first.minutesAgo + 1);
    const [room] = await database
      .insert(chatRooms)
      .values({
        kind: "dm",
        dmLowUserId: ids[0]!,
        dmHighUserId: ids[1]!,
        createdAt: joinedAt,
      })
      .returning({ id: chatRooms.id });
    if (!room) throw new SeedError("시드 DM을 만들지 못했어요.");
    await database.insert(chatRoomMembers).values(
      ids.map((userId) => ({
        roomId: room.id,
        userId,
        status: "active" as const,
        joinedAt,
        statusChangedAt: joinedAt,
        createdAt: joinedAt,
      })),
    );
    const rows = direct.messages.map(
      ({ authorKey, minutesAgo, body }, index) => ({
        roomId: room.id,
        seq: index + 1,
        authorId: userId(authorKey),
        body,
        createdAt: instant(minutesAgo),
      }),
    );
    await database.insert(messages).values(rows);
    const last = rows.at(-1)!;
    await database
      .update(chatRooms)
      .set({ lastSeq: last.seq, lastMessageAt: last.createdAt })
      .where(eq(chatRooms.id, room.id));
    const lastByAuthor = new Map(rows.map((row) => [row.authorId, row]));
    await database.insert(chatRoomReads).values(
      [...lastByAuthor.values()].map((row) => ({
        roomId: room.id,
        userId: row.authorId,
        lastReadSeq: row.seq,
        updatedAt: row.createdAt,
        createdAt: row.createdAt,
      })),
    );
    chatMessages += rows.length;
  }
  return {
    friendships: people.friendships.length,
    directRooms: people.directMessages.length,
    chatMessages,
  };
}
