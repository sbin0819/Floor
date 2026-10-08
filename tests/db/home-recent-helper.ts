import { eq } from "drizzle-orm";
import type { Session } from "@/lib/auth/types";
import { createTeamSpace } from "@/lib/dal/chat-write";
import {
  chatRoomMembers,
  chatRooms,
  messageAttachments,
  messageMentions,
  messages,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import type { TestDatabase } from "./helper";

export const homeRecentNow = new Date("2026-10-08T03:00:00.000Z");
export const homeRecentJoined = new Date("2026-10-01T00:00:00.000Z");

export async function addHomeRecentMessage(
  database: TestDatabase,
  roomId: string,
  authorId: string,
  input: Partial<typeof messages.$inferInsert> = {},
) {
  const [room] = await database.db
    .select({ seq: chatRooms.lastSeq })
    .from(chatRooms)
    .where(eq(chatRooms.id, roomId));
  const [message] = await database.db
    .insert(messages)
    .values({
      roomId,
      authorId,
      kind: "text",
      body: "새 메시지",
      seq: room!.seq + 1,
      createdAt: homeRecentNow,
      ...input,
    })
    .returning();
  await database.db
    .update(chatRooms)
    .set({ lastSeq: message!.seq, lastMessageAt: message!.createdAt })
    .where(eq(chatRooms.id, roomId));
  return message!;
}

export async function addHomeRecentRoom(
  database: TestDatabase,
  userId: string,
  peerId: string,
  kind: "dm" | "group_dm" = "group_dm",
  otherIds: readonly string[] = [],
) {
  const [low, high] = [userId, peerId].sort();
  const [room] = await database.db
    .insert(chatRooms)
    .values(
      kind === "dm" ? { kind, dmLowUserId: low, dmHighUserId: high } : { kind },
    )
    .returning();
  await database.db.insert(chatRoomMembers).values(
    [userId, peerId, ...otherIds].map((id) => ({
      roomId: room!.id,
      userId: id,
      status: "active" as const,
      joinedAt: homeRecentJoined,
      statusChangedAt: homeRecentJoined,
    })),
  );
  return room!.id;
}

/** SQL 계측을 시작하기 전에 실제 세 종류와 첨부·멘션을 모두 준비한다. */
export async function seedHomeRecentChats(
  database: TestDatabase,
  viewerId?: string,
  now = homeRecentNow,
) {
  const peerId = crypto.randomUUID();
  const otherId = crypto.randomUUID();
  const userId = viewerId ?? crypto.randomUUID();
  await database.db
    .insert(users)
    .values([
      ...(!viewerId
        ? [{ id: userId, name: "보는 사람", email: `${userId}@example.test` }]
        : []),
      { id: peerId, name: "박지훈", email: `${peerId}@example.test` },
      { id: otherId, name: "이서연", email: `${otherId}@example.test` },
    ]);
  const [viewer] = await database.db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  const session: Session = { userId, ...viewer! };
  const teamName = `최근 대화 ${userId.slice(0, 8)}`;
  const [team] = await database.db
    .insert(teams)
    .values({ name: teamName, createdBy: userId })
    .returning();
  await database.db.insert(teamMembers).values(
    [userId, peerId, otherId].map((id) => ({
      teamId: team!.id,
      userId: id,
      createdAt: homeRecentJoined,
    })),
  );
  const { spaceId, roomId } = await createTeamSpace(team!.id, database.db);
  if (!roomId) throw new Error("Expected default text channel.");
  const dmId = await addHomeRecentRoom(database, userId, peerId, "dm");
  const groupId = await addHomeRecentRoom(
    database,
    userId,
    peerId,
    "group_dm",
    [otherId],
  );
  const dmMessage = await addHomeRecentMessage(database, dmId, peerId, {
    body: `안녕하세요 <@${userId}>\n반가워요`,
    createdAt: new Date(now.getTime() - 3_000),
  });
  await database.db
    .insert(messageMentions)
    .values({ messageId: dmMessage.id, userId });
  const groupMessage = await addHomeRecentMessage(database, groupId, otherId, {
    body: "",
    createdAt: new Date(now.getTime() - 2_000),
  });
  await database.db.insert(messageAttachments).values(
    [0, 1].map((position) => ({
      roomId: groupId,
      uploaderId: otherId,
      messageId: groupMessage.id,
      position,
      storageKey: crypto.randomUUID(),
      name: `사진${position}.png`,
      size: 12,
      contentType: "image/png",
      kind: "image" as const,
      width: 1,
      height: 1,
      uploadedAt: now,
    })),
  );
  const mentionMessage = await addHomeRecentMessage(database, roomId, peerId, {
    body: `<@${userId}> 확인해 주세요`,
    createdAt: new Date(now.getTime() - 1_000),
  });
  await database.db
    .insert(messageMentions)
    .values({ messageId: mentionMessage.id, userId });
  return {
    session,
    userId,
    peerId,
    otherId,
    teamId: team!.id,
    teamName,
    spaceId,
    dmId,
    groupId,
    mentionRoomId: roomId,
    dmMessage,
    groupMessage,
    mentionMessage,
  };
}
