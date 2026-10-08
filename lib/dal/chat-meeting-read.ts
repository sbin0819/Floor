import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  bookings,
  branches,
  chatRoomReads,
  chatRooms,
  floors,
  spaces,
  users,
} from "@/lib/db/schema";
import type { DalDatabase } from "./database";
import { readableRoomCondition } from "./chat-access";
import { firstUnreadSequence, unreadMentionCount } from "./chat-reads";
import { sharesChatSpace } from "./group-dm";
import { blockedBy } from "./people-blocks";

export function listMeetingMembers(
  bookingId: string,
  viewerId: string,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      id: users.id,
      name: users.name,
      username: users.username,
      admin: sql<false>`false`,
      isBooker: sql<boolean>`${users.id} = ${bookings.userId}`,
      sharesSpace: sharesChatSpace(viewerId, sql`${users.id}`),
      canMention: sql<boolean>`not ${blockedBy(sql`${users.id}`, sql`${viewerId}::uuid`)}`,
    })
    .from(bookings)
    .innerJoin(
      users,
      sql`${users.id} = ${bookings.userId} or exists (
    select 1 from booking_participants p where p.booking_id = ${bookings.id} and p.user_id = ${users.id}
  )`,
    )
    .where(eq(bookings.id, bookingId))
    .orderBy(
      desc(sql`${users.id} = ${bookings.userId}`),
      asc(users.name),
      asc(users.id),
    );
}

export function listMeetingNav(
  userId: string,
  now: Date,
  database: DalDatabase = getDb(),
) {
  return database
    .select({
      bookingId: bookings.id,
      roomId: chatRooms.id,
      title: bookings.title,
      spaceName: spaces.name,
      during: bookings.during,
      timezone: branches.timezone,
      unread: sql<boolean>`${firstUnreadSequence(userId)} is not null`,
      unreadMentions: unreadMentionCount(userId),
      muted: sql<boolean>`coalesce(${chatRoomReads.muted}, false)`,
    })
    .from(chatRooms)
    .innerJoin(bookings, eq(bookings.id, chatRooms.bookingId))
    .innerJoin(spaces, eq(spaces.id, bookings.spaceId))
    .innerJoin(floors, eq(floors.id, spaces.floorId))
    .innerJoin(branches, eq(branches.id, floors.branchId))
    .leftJoin(
      chatRoomReads,
      and(
        eq(chatRoomReads.roomId, chatRooms.id),
        eq(chatRoomReads.userId, userId),
      ),
    )
    .where(
      and(
        eq(chatRooms.kind, "meeting"),
        eq(bookings.status, "confirmed"),
        sql`upper(${bookings.during}) > ${new Date(now.getTime() - 86_400_000).toISOString()}::timestamptz`,
        readableRoomCondition(userId),
      ),
    )
    .orderBy(asc(sql`lower(${bookings.during})`), asc(bookings.id))
    .limit(20);
}
