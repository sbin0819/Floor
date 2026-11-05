import "server-only";

// 한 달치 일정 시드 전용의 묶음 쓰기다. 기능 액션에서 쓰지 않는다.
import { and, asc, eq, inArray, max, sql } from "drizzle-orm";
import type { DalDatabase } from "@/lib/dal/database";
import { serializeTimeRange, type TimeRange } from "@/lib/db/range";
import {
  announcements,
  bookingParticipants,
  bookings,
  chatRoomReads,
  chatRooms,
  chatSpaces,
  messages,
  notifications,
  spaceBlocks,
  spaces,
  users,
} from "@/lib/db/schema";
import type { SystemMessageData } from "@/features/chat/system-messages";

const CHUNK = 200;
function chunks<T>(rows: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += CHUNK)
    result.push(rows.slice(index, index + CHUNK));
  return result;
}

/** 시드가 만들 수 있는 모든 id의 예약·점검·공지를 지운다. 회의 채널·참석자·알림은 외래 키로 함께 지워진다. */
export async function clearSeedSchedule(
  ids: {
    bookingIds: readonly string[];
    blockIds: readonly string[];
    announcementIds: readonly string[];
  },
  db: DalDatabase,
) {
  for (const part of chunks(ids.bookingIds))
    await db.delete(bookings).where(inArray(bookings.id, part));
  for (const part of chunks(ids.blockIds))
    await db.delete(spaceBlocks).where(inArray(spaceBlocks.id, part));
  for (const part of chunks(ids.announcementIds)) {
    await db.delete(notifications).where(
      and(
        eq(notifications.type, "branch_announcement"),
        sql`${notifications.data}->>'announcementId' in (${sql.join(
          part.map((id) => sql`${id}`),
          sql`, `,
        )})`,
      ),
    );
    await db.delete(messages).where(inArray(messages.clientId, part));
    await db.delete(announcements).where(inArray(announcements.id, part));
  }
}

/** 시드 범위의 기간에 남아 있는(시드가 아닌) 확정 예약. 겹침을 미리 피하는 데 쓴다. */
export async function listForeignConfirmedBookings(
  input: {
    spaceIds: readonly string[];
    userIds: readonly string[];
    window: TimeRange;
  },
  db: DalDatabase,
) {
  if (!input.spaceIds.length && !input.userIds.length) return [];
  const rows = await db
    .select({
      spaceId: bookings.spaceId,
      userId: bookings.userId,
      during: bookings.during,
      isDesk: sql<boolean>`${spaces.type} = 'desk'`,
    })
    .from(bookings)
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .where(
      and(
        eq(bookings.status, "confirmed"),
        sql`${bookings.during} && ${serializeTimeRange(input.window)}::tstzrange`,
        sql`(${bookings.spaceId} in (${sql.join(
          input.spaceIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}) or ${bookings.userId} in (${sql.join(
          input.userIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}))`,
      ),
    );
  return rows;
}

export async function insertSeedBlocks(
  rows: readonly (typeof spaceBlocks.$inferInsert)[],
  db: DalDatabase,
) {
  for (const part of chunks(rows)) await db.insert(spaceBlocks).values(part);
}

export async function insertSeedBookings(
  rows: readonly (typeof bookings.$inferInsert)[],
  db: DalDatabase,
) {
  for (const part of chunks(rows)) await db.insert(bookings).values(part);
}

export async function insertSeedParticipants(
  rows: readonly (typeof bookingParticipants.$inferInsert)[],
  db: DalDatabase,
) {
  for (const part of chunks(rows))
    await db.insert(bookingParticipants).values(part);
}

export type SeedMeetingRoomInput = {
  bookingId: string;
  createdAt: Date;
  /** 번호 1부터 차례로 들어가는 메시지. 시스템 메시지는 kind가 system이다. */
  messages: {
    authorId: string | null;
    kind: "text" | "system";
    body: string;
    systemData: SystemMessageData | null;
    createdAt: Date;
  }[];
  /** 메시지와 별개로 읽음 자리를 남길 사람(예약한 사람·취소한 사람). */
  readers: { userId: string; seq: number; at: Date }[];
};

/** 회의 채널·메시지·읽음 자리를 묶어 넣는다. 방의 마지막 번호·시각은 넣는 메시지로 정한다. */
export async function insertSeedMeetingRooms(
  inputs: readonly SeedMeetingRoomInput[],
  db: DalDatabase,
) {
  let chatMessages = 0;
  for (const part of chunks(inputs)) {
    const rooms = await db
      .insert(chatRooms)
      .values(
        part.map((input) => {
          const last = input.messages.at(-1);
          return {
            kind: "meeting" as const,
            bookingId: input.bookingId,
            createdAt: input.createdAt,
            lastSeq: input.messages.length,
            lastMessageAt: last?.createdAt ?? null,
          };
        }),
      )
      .returning({ id: chatRooms.id, bookingId: chatRooms.bookingId });
    const roomId = new Map(rooms.map((room) => [room.bookingId, room.id]));
    const messageRows = part.flatMap((input) =>
      input.messages.map((message, index) => ({
        roomId: roomId.get(input.bookingId)!,
        seq: index + 1,
        authorId: message.authorId,
        kind: message.kind,
        body: message.body,
        systemData: message.systemData,
        createdAt: message.createdAt,
      })),
    );
    for (const rows of chunks(messageRows))
      await db.insert(messages).values(rows);
    chatMessages += messageRows.length;
    const reads = new Map<string, typeof chatRoomReads.$inferInsert>();
    for (const input of part) {
      const room = roomId.get(input.bookingId)!;
      const candidates = [
        ...input.readers,
        ...input.messages.flatMap((message, index) =>
          message.authorId
            ? [
                {
                  userId: message.authorId,
                  seq: index + 1,
                  at: message.createdAt,
                },
              ]
            : [],
        ),
      ];
      for (const reader of candidates) {
        const key = `${room}:${reader.userId}`;
        const existing = reads.get(key);
        if (!existing || existing.lastReadSeq < reader.seq)
          reads.set(key, {
            roomId: room,
            userId: reader.userId,
            lastReadSeq: reader.seq,
            createdAt: existing?.createdAt ?? reader.at,
            updatedAt: reader.at,
          });
      }
    }
    for (const rows of chunks([...reads.values()]))
      await db.insert(chatRoomReads).values(rows);
  }
  return { meetingRooms: inputs.length, chatMessages };
}

export async function setSeedDefaultBranches(
  rows: readonly { userId: string; branchId: string }[],
  db: DalDatabase,
) {
  // 이미 기본 지점이 있는 계정은 바꾸지 않는다 (첫 예약이 채우는 규칙과 같다).
  for (const row of rows)
    await db
      .update(users)
      .set({
        defaultBranchId: row.branchId,
        updatedAt: sql`${users.updatedAt}`,
      })
      .where(
        and(eq(users.id, row.userId), sql`${users.defaultBranchId} is null`),
      );
}

/** 지점 라운지의 `# 공지` 채널과 다음 메시지 번호를 찾는다. */
export async function findSeedNoticeRooms(
  branchIds: readonly string[],
  db: DalDatabase,
) {
  if (!branchIds.length)
    return new Map<string, { roomId: string; nextSeq: number }>();
  const rows = await db
    .select({
      branchId: chatSpaces.branchId,
      roomId: chatRooms.id,
      lastSeq: chatRooms.lastSeq,
      maxSeq: max(messages.seq),
    })
    .from(chatRooms)
    .innerJoin(chatSpaces, eq(chatSpaces.id, chatRooms.spaceId))
    .leftJoin(messages, eq(messages.roomId, chatRooms.id))
    .where(
      and(
        eq(chatSpaces.kind, "branch"),
        inArray(chatSpaces.branchId, [...branchIds]),
        eq(chatRooms.kind, "text"),
        eq(chatRooms.name, "공지"),
        eq(chatRooms.adminOnly, true),
        sql`${chatRooms.archivedAt} is null`,
      ),
    )
    .groupBy(chatSpaces.branchId, chatRooms.id, chatRooms.lastSeq)
    .orderBy(asc(chatRooms.createdAt));
  const result = new Map<string, { roomId: string; nextSeq: number }>();
  for (const row of rows)
    if (row.branchId && !result.has(row.branchId))
      result.set(row.branchId, {
        roomId: row.roomId,
        nextSeq: Math.max(row.lastSeq, Number(row.maxSeq ?? 0)) + 1,
      });
  return result;
}

export type SeedAnnouncementInput = {
  id: string;
  branchId: string;
  authorId: string;
  title: string;
  body: string;
  audience: {
    date: string;
    floorId: string | null;
    spaceId: string | null;
  } | null;
  recipientCount: number;
  at: Date;
  lounge: { roomId: string; seq: number } | null;
};

export async function insertSeedAnnouncements(
  inputs: readonly SeedAnnouncementInput[],
  db: DalDatabase,
) {
  let chatMessages = 0;
  for (const input of inputs) {
    let loungeMessageId: string | null = null;
    if (input.lounge) {
      const [message] = await db
        .insert(messages)
        .values({
          roomId: input.lounge.roomId,
          seq: input.lounge.seq,
          authorId: input.authorId,
          kind: "text",
          body: `${input.title}\n\n${input.body}\n\n<@everyone>`,
          clientId: input.id,
          mentionsEveryone: true,
          createdAt: input.at,
        })
        .returning({ id: messages.id });
      loungeMessageId = message?.id ?? null;
      chatMessages += 1;
      await db
        .update(chatRooms)
        .set({
          lastSeq: sql`greatest(${chatRooms.lastSeq}, ${input.lounge.seq})`,
          lastMessageAt: sql`greatest(coalesce(${chatRooms.lastMessageAt}, ${input.at.toISOString()}::timestamptz), ${input.at.toISOString()}::timestamptz)`,
        })
        .where(eq(chatRooms.id, input.lounge.roomId));
      await db
        .insert(chatRoomReads)
        .values({
          roomId: input.lounge.roomId,
          userId: input.authorId,
          lastReadSeq: input.lounge.seq,
          createdAt: input.at,
          updatedAt: input.at,
        })
        .onConflictDoUpdate({
          target: [chatRoomReads.roomId, chatRoomReads.userId],
          set: {
            lastReadSeq: sql`greatest(${chatRoomReads.lastReadSeq}, excluded.last_read_seq)`,
            updatedAt: sql`excluded.updated_at`,
          },
        });
    }
    await db.insert(announcements).values({
      id: input.id,
      branchId: input.branchId,
      authorId: input.authorId,
      title: input.title,
      body: input.body,
      loungeMessageId,
      audience: input.audience,
      recipientCount: input.recipientCount,
      createdAt: input.at,
    });
  }
  return { announcements: inputs.length, chatMessages };
}

export async function readSeedUserNames(
  ids: readonly string[],
  db: DalDatabase,
) {
  if (!ids.length) return new Map<string, string>();
  const rows = await db
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(inArray(users.id, [...ids]));
  return new Map(rows.map((row) => [row.id, row.name]));
}

/** 알림을 묶어 넣는다. 지난 알림은 읽은 것으로 넣을 수 있다. */
export async function insertSeedNotifications(
  rows: readonly (typeof notifications.$inferInsert)[],
  db: DalDatabase,
) {
  for (const part of chunks(rows)) await db.insert(notifications).values(part);
}
