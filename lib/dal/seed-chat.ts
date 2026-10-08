import "server-only";

import { eq, inArray } from "drizzle-orm";
import { createTeamSpace } from "@/lib/dal/chat-write";
import type { DalDatabase } from "@/lib/dal/database";
import { chatRoomReads, chatRooms, messages } from "@/lib/db/schema";
import type { SeedChatData } from "@/lib/seed/chat";
import { SeedError } from "@/lib/seed/errors";

export async function syncSeedChat(
  teamIds: readonly string[],
  chat: SeedChatData,
  userIds: ReadonlyMap<string, string>,
  now: Date,
  database: DalDatabase,
): Promise<{ chatSpaces: number; chatMessages: number }> {
  if (!teamIds.length) return { chatSpaces: 0, chatMessages: 0 };
  const channels = new Map<string, { spaceId: string; roomId: string }>();
  for (const teamId of teamIds) {
    const channel = await createTeamSpace(teamId, database);
    if (!channel.roomId)
      throw new SeedError(
        "시드 팀의 기본 채널을 찾을 수 없어요. 기존 채널을 변경하지 않았어요.",
      );
    channels.set(teamId, { ...channel, roomId: channel.roomId });
  }
  const sequence = new Map<string, number>();
  const rows = chat.messages.map(({ teamId, authorKey, minutesAgo, body }) => {
    const channel = channels.get(teamId);
    const authorId = userIds.get(authorKey);
    const createdAt = new Date(now.getTime() - minutesAgo * 60_000);
    if (!channel || !authorId || !Number.isFinite(createdAt.getTime()))
      throw new SeedError(
        "채팅 시드의 계정·팀 참조 또는 시각이 올바르지 않아요.",
      );
    const seq = (sequence.get(teamId) ?? 0) + 1;
    sequence.set(teamId, seq);
    return {
      roomId: channel.roomId,
      authorId,
      seq,
      body,
      kind: "text" as const,
      createdAt,
    };
  });
  const spaceIds = [...channels.values()].map(({ spaceId }) => spaceId);
  // 전체 시드는 자기 팀 스페이스만 다시 채우고, 다른 팀의 대화는 보존한다.
  await database
    .delete(messages)
    .where(
      inArray(
        messages.roomId,
        database
          .select({ id: chatRooms.id })
          .from(chatRooms)
          .where(inArray(chatRooms.spaceId, spaceIds)),
      ),
    );
  await database
    .update(chatRooms)
    .set({ lastSeq: 0, lastMessageAt: null })
    .where(inArray(chatRooms.spaceId, spaceIds));
  // 번호를 다시 매기므로 읽음 위치도 되돌린다. 알림 끔과 가입 시각은 유지한다.
  await database
    .update(chatRoomReads)
    .set({ lastReadSeq: 0, updatedAt: now })
    .where(
      inArray(
        chatRoomReads.roomId,
        database
          .select({ id: chatRooms.id })
          .from(chatRooms)
          .where(inArray(chatRooms.spaceId, spaceIds)),
      ),
    );
  if (rows.length) await database.insert(messages).values(rows);
  const lastByRoom = new Map(rows.map((row) => [row.roomId, row]));
  for (const row of lastByRoom.values())
    await database
      .update(chatRooms)
      .set({ lastSeq: row.seq, lastMessageAt: row.createdAt })
      .where(eq(chatRooms.id, row.roomId));
  return { chatSpaces: channels.size, chatMessages: rows.length };
}
