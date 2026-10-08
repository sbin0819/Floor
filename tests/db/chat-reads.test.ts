import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createChatQueries } from "@/features/chat/query-factory";
import { canReadSpace } from "@/lib/dal/chat-access";
import {
  chatRoomReads,
  chatRooms,
  chatSpaces,
  messages,
  teamMembers,
} from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";
import { createQueryMeter } from "./query-meter";

const joinedAt = new Date("2026-10-01T00:00:00Z");
const afterJoin = new Date("2026-10-01T00:00:01Z");
describe("chat read cursor constraints and unread boundaries", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`truncate users, branches cascade`);
    actors = await seedChatActors(database);
  });
  const queries = () =>
    createChatQueries({
      database: database.db,
      requireSession: async () => actors.member,
      now: () => chatNow,
    });
  async function addMessage(
    seq: number,
    authorId: string | null,
    createdAt: Date,
    roomId = actors.roomId,
  ) {
    await database.db.insert(messages).values({
      roomId,
      seq,
      authorId,
      kind: authorId ? "text" : "system",
      body: "가상 메시지",
      createdAt,
    });
    await database.db
      .update(chatRooms)
      .set({ lastSeq: seq, lastMessageAt: createdAt })
      .where(eq(chatRooms.id, roomId));
  }
  async function readCursor(seq: number) {
    await database.db.insert(chatRoomReads).values({
      roomId: actors.roomId,
      userId: actors.member.userId,
      lastReadSeq: seq,
      updatedAt: chatNow,
    });
  }
  async function expectUnread(
    seq: number | null,
    lastReadSeq: number | null = null,
  ) {
    const nav = (await queries().getMyChatNav()).spaces;
    expect(nav).toHaveLength(1);
    expect(nav[0]!.unread).toBe(seq !== null);
    expect(
      nav[0]!.channels.find(({ id }) => id === actors.roomId)?.unread,
    ).toBe(seq !== null);
    const view = await queries().getChannelView(actors.spaceId, actors.roomId);
    expect(view).toMatchObject({ lastReadSeq, firstUnreadSeq: seq });
  }

  it("24: rejects duplicate room-user cursors and negative sequence numbers", async () => {
    await readCursor(0);
    await expect(readCursor(1)).rejects.toMatchObject({
      cause: { code: "23505" },
    });
    await expect(
      database.db.insert(chatRoomReads).values({
        roomId: actors.roomId,
        userId: actors.admin.userId,
        lastReadSeq: -1,
        updatedAt: chatNow,
      }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint: "chat_room_reads_seq_valid" },
    });
    expect(await database.db.select().from(chatRoomReads)).toEqual([
      expect.objectContaining({
        lastReadSeq: 0,
        muted: false,
        updatedAt: chatNow,
        createdAt: expect.any(Date),
      }),
    ]);
  });
  it("24: deleting a room cascades only its cursors", async () => {
    await readCursor(0);
    await database.db.insert(chatRoomReads).values({
      roomId: actors.secondRoomId,
      userId: actors.member.userId,
      lastReadSeq: 0,
      updatedAt: chatNow,
    });
    await database.db.delete(chatRooms).where(eq(chatRooms.id, actors.roomId));
    expect(await database.db.select().from(chatRoomReads)).toEqual([
      expect.objectContaining({ roomId: actors.secondRoomId }),
    ]);
  });
  it("does not mark messages at or before joining as unread without a cursor", async () => {
    await addMessage(1, actors.admin.userId, new Date("2026-09-30T23:59:59Z"));
    await addMessage(2, actors.admin.userId, joinedAt);
    await expectUnread(null);
  });
  it("finds the first other-author message after joining without counting my messages", async () => {
    await addMessage(1, actors.member.userId, afterJoin);
    await expectUnread(null);
    await addMessage(2, actors.admin.userId, afterJoin);
    await addMessage(3, actors.admin.userId, chatNow);
    await expectUnread(2);
  });
  it("includes authorless system messages in unread state", async () => {
    await addMessage(1, null, afterJoin);
    await expectUnread(1);
  });
  it("does not scan old history when room last-message time has not passed joining", async () => {
    await addMessage(1, actors.admin.userId, afterJoin);
    await database.db
      .update(chatRooms)
      .set({ lastMessageAt: joinedAt })
      .where(eq(chatRooms.id, actors.roomId));
    await expectUnread(null);
  });
  it("uses a strict sequence boundary and skips my messages after a cursor", async () => {
    await addMessage(1, actors.admin.userId, afterJoin);
    await readCursor(1);
    await expectUnread(null, 1);
    await addMessage(2, actors.member.userId, afterJoin);
    await expectUnread(null, 1);
    await addMessage(3, actors.admin.userId, afterJoin);
    await expectUnread(3, 1);
  });
  it("still checks the joined-at boundary when an old cursor survives rejoining", async () => {
    await readCursor(1);
    await addMessage(2, actors.admin.userId, afterJoin);
    await database.db
      .update(teamMembers)
      .set({ createdAt: chatNow })
      .where(
        and(
          eq(teamMembers.teamId, actors.teamId),
          eq(teamMembers.userId, actors.member.userId),
        ),
      );
    await expectUnread(null, 1);
    await addMessage(3, null, new Date(chatNow.getTime() + 1));
    await expectUnread(3, 1);
  });
  it("ignores archived channels in space unread status but keeps their readable cursor", async () => {
    await addMessage(1, actors.admin.userId, afterJoin);
    await database.db
      .update(chatRooms)
      .set({ archivedAt: chatNow })
      .where(eq(chatRooms.id, actors.roomId));
    expect((await queries().getMyChatNav()).spaces[0]!.unread).toBe(false);
    expect(
      await queries().getChannelView(actors.spaceId, actors.roomId),
    ).toMatchObject({ firstUnreadSeq: 1, canWrite: false });
  });
  it("reads spaces only for actual team members and hides deleted spaces", async () => {
    expect(
      await canReadSpace(actors.member.userId, actors.spaceId, database.db),
    ).toMatchObject({ id: actors.spaceId });
    for (const userId of [actors.outsider.userId, actors.operator.userId])
      expect(
        await canReadSpace(userId, actors.spaceId, database.db),
      ).toBeNull();
    expect(
      await canReadSpace(
        actors.member.userId,
        actors.otherSpace.spaceId,
        database.db,
      ),
    ).toBeNull();
    await database.db
      .update(chatSpaces)
      .set({ deletedAt: chatNow })
      .where(eq(chatSpaces.id, actors.spaceId));
    expect(
      await canReadSpace(actors.member.userId, actors.spaceId, database.db),
    ).toBeNull();
  });
  it("keeps navigation to one statement and channel view to two stages across many rooms", async () => {
    await database.db.insert(chatRooms).values(
      Array.from({ length: 25 }, (_, index) => ({
        kind: "text" as const,
        spaceId: actors.spaceId,
        name: `추가 채널 ${index}`,
      })),
    );
    await addMessage(1, actors.admin.userId, afterJoin);
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      await queries().getMyChatNav();
      expect(meter.stop()).toMatchObject({
        stages: 1,
        statements: 2,
        perStage: [2],
      });
      meter.start();
      await queries().getChannelView(actors.spaceId, actors.roomId);
      expect(meter.stop()).toMatchObject({
        stages: 2,
        statements: 3,
        perStage: [1, 2],
      });
    } finally {
      meter.restore();
    }
  });
});
