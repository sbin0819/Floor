import "server-only";

import { eq, sql } from "drizzle-orm";
import { createMeetingRoom } from "./chat-meeting";
import { insertSystemMessage } from "./chat-write";
import type { DalDatabase } from "./database";
import { chatRoomReads, chatRooms, messages, users } from "@/lib/db/schema";
import type { SeedMeetingData } from "@/lib/seed/meeting";
import { SeedError } from "@/lib/seed/errors";

// 예약·참석자를 넣은 같은 트랜잭션에서, 새 시간 예약에만 호출한다.
export async function insertSeedMeeting(
  input: {
    bookingId: string;
    bookerId: string;
    messages: SeedMeetingData["messages"];
    userIds: ReadonlyMap<string, string>;
    createdAt: Date;
    now: Date;
  },
  database: DalDatabase,
) {
  const [booker] = await database
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, input.bookerId));
  if (!booker) throw new SeedError("회의 시드의 예약한 계정이 없어요.");
  const room = await createMeetingRoom(
    { bookingId: input.bookingId, now: input.createdAt },
    database,
  );
  const initial = await insertSystemMessage(
    {
      roomId: room.id,
      actorId: input.bookerId,
      data: { type: "booking_created", actorName: booker.name },
      now: input.createdAt,
    },
    database,
  );
  const rows = input.messages.map(({ authorKey, minutesAgo, body }, index) => {
    const authorId = input.userIds.get(authorKey);
    const createdAt = new Date(input.now.getTime() - minutesAgo * 60_000);
    if (!authorId || !Number.isFinite(createdAt.getTime()))
      throw new SeedError("회의 시드의 작성자 또는 시각이 올바르지 않아요.");
    return {
      roomId: room.id,
      seq: initial.seq + index + 1,
      authorId,
      body,
      createdAt,
    };
  });
  if (rows.length) {
    await database.insert(messages).values(rows);
    const last = rows.at(-1)!;
    await database
      .update(chatRooms)
      .set({ lastSeq: last.seq, lastMessageAt: last.createdAt })
      .where(eq(chatRooms.id, room.id));
    const reads = [...new Map(rows.map((row) => [row.authorId, row])).values()];
    await database
      .insert(chatRoomReads)
      .values(
        reads.map((row) => ({
          roomId: room.id,
          userId: row.authorId,
          lastReadSeq: row.seq,
          createdAt: row.createdAt,
          updatedAt: row.createdAt,
        })),
      )
      .onConflictDoUpdate({
        target: [chatRoomReads.roomId, chatRoomReads.userId],
        set: {
          lastReadSeq: sql`greatest(${chatRoomReads.lastReadSeq}, excluded.last_read_seq)`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
  }
  return { meetingRooms: 1, chatMessages: rows.length + 1 };
}
