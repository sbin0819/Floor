import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq, sql } from "drizzle-orm";
import { createSpaceSettingsQueries } from "@/features/chat/space-settings-queries";
import {
  chatRooms,
  chatSpaces,
  chatSpaceMembers,
  branches,
} from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import { seedChatActors, chatNow, type ChatActors } from "./chat-helper";
import { createQueryMeter } from "./query-meter";

describe("space settings read", () => {
  let database: TestDatabase, actors: ChatActors;
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
  const queries = (user = actors.member) =>
    createSpaceSettingsQueries({
      database: database.db,
      requireSession: async () => user,
    });
  it("reads only this team's channels and role in one statement", async () => {
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const data = await queries().getSpaceSettings(actors.spaceId);
      expect(meter.stop()).toEqual({ stages: 1, statements: 1, perStage: [1] });
      expect(data).toMatchObject({
        name: "가상 채팅팀",
        role: "member",
        kind: "team",
      });
      expect(data?.channels.map(({ id }) => id).sort()).toEqual(
        [actors.roomId, actors.secondRoomId].sort(),
      );
      expect(data?.channels).not.toContainEqual(
        expect.objectContaining({ id: actors.otherSpace.roomId }),
      );
      expect(data && Object.keys(data).sort()).toEqual(
        ["id", "kind", "name", "iconColor", "role", "channels"].sort(),
      );
    } finally {
      meter.restore();
    }
  });
  it("does not confuse an unrelated administrator with this team's administrator", async () => {
    expect(
      await queries(actors.outsider).getSpaceSettings(actors.spaceId),
    ).toBeNull();
    expect(
      await queries(actors.admin).getSpaceSettings(actors.spaceId),
    ).toMatchObject({ role: "admin" });
    expect(await queries().getSpaceSettings(crypto.randomUUID())).toBeNull();
  });
  it("omits archived channels without recreating defaults", async () => {
    await database.db
      .update(chatRooms)
      .set({ archivedAt: chatNow })
      .where(eq(chatRooms.spaceId, actors.spaceId));
    expect(await queries().getSpaceSettings(actors.spaceId)).toMatchObject({
      channels: [],
    });
  });
  it("handles communities and lounges without leaking member lists or source ids", async () => {
    const [branch] = await database.db
      .insert(branches)
      .values({ name: "가상 설정 지점" })
      .returning();
    const spaces = await database.db
      .insert(chatSpaces)
      .values([
        { kind: "branch", branchId: branch!.id },
        {
          kind: "community",
          name: "설정 모임",
          createdBy: actors.member.userId,
        },
      ])
      .returning();
    for (const space of spaces) {
      await database.db
        .insert(chatSpaceMembers)
        .values({
          spaceId: space.id,
          userId: actors.member.userId,
          role: space.kind === "community" ? "owner" : "member",
          joinedAt: chatNow,
          statusChangedAt: chatNow,
        });
      const result = await queries().getSpaceSettings(space.id);
      expect(result).toMatchObject({
        name: space.kind === "branch" ? "가상 설정 지점" : "설정 모임",
        role: space.kind === "branch" ? "member" : "owner",
      });
      expect(result).not.toHaveProperty("branchId");
      expect(result).not.toHaveProperty("roleSettings");
      expect(
        await queries(actors.outsider).getSpaceSettings(space.id),
      ).toBeNull();
      await database.db
        .update(chatSpaces)
        .set({ deletedAt: chatNow })
        .where(eq(chatSpaces.id, space.id));
      expect(await queries().getSpaceSettings(space.id)).toBeNull();
    }
  });
  it("checks the session even for malformed input, without DB access", async () => {
    const session = vi.fn(async () => actors.member);
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      expect(
        await createSpaceSettingsQueries({
          database: database.db,
          requireSession: session,
        }).getSpaceSettings("invalid"),
      ).toBeNull();
      expect(meter.stop().statements).toBe(0);
      expect(session).toHaveBeenCalledOnce();
    } finally {
      meter.restore();
    }
  });
});
