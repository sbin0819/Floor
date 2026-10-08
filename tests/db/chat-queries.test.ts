import { eq, sql } from "drizzle-orm";
import { avatarColorFor } from "@/lib/avatar";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createChatQueries } from "@/features/chat/query-factory";
import { canReadRoom, canWriteRoom } from "@/lib/dal/chat-access";
import { createTeamSpace } from "@/lib/dal/chat-write";
import { createTeam } from "@/lib/dal/teams-write";
import * as readDal from "@/lib/dal/chat-read";
import * as accessDal from "@/lib/dal/chat-access";
import * as writeDal from "@/lib/dal/chat-write";
import {
  branchStaff,
  branches,
  chatRooms,
  chatSpaces,
  messages,
  teamMembers,
  teams,
} from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";

describe("team chat access and queries", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    await database.db.execute(sql`truncate users, branches cascade`);
    actors = await seedChatActors(database);
  });
  const queries = (session = actors.member) =>
    createChatQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => chatNow,
    });

  it("returns only my spaces and active channels, without email or foreign client ids", async () => {
    await database.db.insert(messages).values([
      {
        roomId: actors.roomId,
        authorId: actors.member.userId,
        seq: 1,
        body: "내 글",
        clientId: "own",
      },
      {
        roomId: actors.roomId,
        authorId: actors.admin.userId,
        seq: 2,
        body: "남의 글",
        clientId: "private-client",
      },
    ]);
    const nav = (await queries().getMyChatNav()).spaces;
    expect(nav).toHaveLength(1);
    expect(nav[0]).toMatchObject({
      id: actors.spaceId,
      kind: "team",
      name: "가상 채팅팀",
      initial: "가",
    });
    expect(nav[0]!.channels.map(({ name }) => name)).toContain("일반");
    const view = await queries().getChannelView(actors.spaceId, actors.roomId);
    expect(view!.canWrite).toBe(true);
    expect(view!.messages.map(({ seq }) => seq)).toEqual([1, 2]);
    expect(view!.messages.map(({ clientId }) => clientId)).toEqual([
      "own",
      null,
    ]);
    expect(JSON.stringify(view)).not.toContain("@");
    expect(view!.members).toEqual(
      expect.arrayContaining([
        {
          id: actors.admin.userId,
          name: "관리자",
          admin: true,
          avatar: {
            color: avatarColorFor(actors.admin.userId, null),
            photoUrl: null,
          },
        },
      ]),
    );
  });

  it("does not expose a private room to outsiders, operators, former members or a mismatched parent", async () => {
    const [branch] = await database.db
      .insert(branches)
      .values({ name: "운영 지점" })
      .returning();
    await database.db
      .insert(branchStaff)
      .values({ branchId: branch!.id, userId: actors.operator.userId });
    const read = vi.spyOn(readDal, "listRecentMessages");
    for (const session of [actors.outsider, actors.operator]) {
      expect(
        await queries(session).getChannelView(actors.spaceId, actors.roomId),
      ).toBeNull();
      expect(
        (await queries(session).getMyChatNav()).spaces.some(
          ({ id }) => id === actors.spaceId,
        ),
      ).toBe(false);
    }
    expect(
      await queries().getChannelView(actors.otherSpace.spaceId, actors.roomId),
    ).toBeNull();
    await database.db
      .delete(teamMembers)
      .where(eq(teamMembers.userId, actors.member.userId));
    expect(
      await queries().getChannelView(actors.spaceId, actors.roomId),
    ).toBeNull();
    expect(read).not.toHaveBeenCalled();
  });

  it("rejects malformed UUIDs before consulting DAL and independently requires a session", async () => {
    const access = vi.spyOn(accessDal, "canReadRoom");
    const read = vi.spyOn(readDal, "listRecentMessages");
    expect(await queries().getChannelView("join", actors.roomId)).toBeNull();
    expect(
      await queries().getChannelView(actors.spaceId, "invalid"),
    ).toBeNull();
    expect(read).not.toHaveBeenCalled();
    expect(access).not.toHaveBeenCalled();
    const requireSession = vi
      .fn()
      .mockRejectedValue(new Error("unauthenticated"));
    const secured = createChatQueries({
      database: database.db,
      requireSession,
    });
    await expect(secured.getMyChatNav()).rejects.toThrow("unauthenticated");
    await expect(
      secured.getChannelView(actors.spaceId, actors.roomId),
    ).rejects.toThrow("unauthenticated");
    expect(requireSession).toHaveBeenCalledTimes(2);
  });

  it("hides deleted spaces and excludes voice from text navigation; archived rooms remain readable but not writable", async () => {
    await database.db
      .update(chatRooms)
      .set({ archivedAt: chatNow })
      .where(eq(chatRooms.id, actors.roomId));
    expect(
      (await queries().getMyChatNav()).spaces[0]!.channels.some(
        ({ id }) => id === actors.roomId,
      ),
    ).toBe(false);
    expect(
      (await queries().getChannelView(actors.spaceId, actors.roomId))!.canWrite,
    ).toBe(false);
    await database.db
      .update(chatRooms)
      .set({ kind: "voice", voiceCapacity: 10 })
      .where(eq(chatRooms.id, actors.roomId));
    expect(
      await canReadRoom(actors.member.userId, actors.roomId, database.db),
    ).toMatchObject({ kind: "voice", voiceCapacity: 10 });
    expect(
      (await canWriteRoom(actors.member.userId, actors.roomId, database.db))
        .canWrite,
    ).toBe(false);
    expect(
      (await queries().getMyChatNav()).spaces[0]!.channels.some(
        ({ id }) => id === actors.roomId,
      ),
    ).toBe(false);
    await database.db
      .update(chatSpaces)
      .set({ deletedAt: chatNow })
      .where(eq(chatSpaces.id, actors.spaceId));
    expect((await queries().getMyChatNav()).spaces).toEqual([]);
  });

  it("allows admin-only writing only for team admins", async () => {
    await database.db
      .update(chatRooms)
      .set({ adminOnly: true })
      .where(eq(chatRooms.id, actors.roomId));
    expect(
      (await canWriteRoom(actors.member.userId, actors.roomId, database.db))
        .canWrite,
    ).toBe(false);
    expect(
      (await canWriteRoom(actors.admin.userId, actors.roomId, database.db))
        .canWrite,
    ).toBe(true);
  });

  it("returns the latest fifty messages in ascending sequence order", async () => {
    await database.db.insert(messages).values(
      Array.from({ length: 60 }, (_, index) => ({
        roomId: actors.roomId,
        authorId: actors.admin.userId,
        seq: index + 1,
        body: `내용 ${index}`,
      })),
    );
    const view = await queries().getChannelView(actors.spaceId, actors.roomId);
    expect(view!.messages.map(({ seq }) => seq)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 11),
    );
  });

  it("creates a default channel atomically with a team and reuses it on repeated provisioning", async () => {
    const input = {
      userId: actors.member.userId,
      name: "새로운 팀",
      homeBranchId: null,
      headcount: 2,
      contactPhone: "01012345678",
      title: null,
    };
    const team = await createTeam(input, database.db);
    const first = await createTeamSpace(team.id, database.db);
    expect(await createTeamSpace(team.id, database.db)).toEqual(first);
    await expect(createTeam(input, database.db)).rejects.toMatchObject({
      cause: { code: "23505" },
    });
    expect(await database.db.select().from(chatSpaces)).toHaveLength(3);
    await database.db
      .update(teams)
      .set({ name: "고친 팀" })
      .where(eq(teams.id, team.id));
    expect(
      (await queries().getMyChatNav()).spaces.some(
        ({ name }) => name === "고친 팀",
      ),
    ).toBe(true);
  });

  it("rolls back the team and membership if provisioning fails midway", async () => {
    const original = writeDal.createTeamSpace;
    vi.spyOn(writeDal, "createTeamSpace").mockImplementationOnce(
      async (...args) => {
        await original(...args);
        throw new Error("Injected provisioning failure");
      },
    );
    await expect(
      createTeam(
        {
          userId: actors.member.userId,
          name: "실패 팀",
          homeBranchId: null,
          headcount: 2,
          contactPhone: "01012345678",
          title: null,
        },
        database.db,
      ),
    ).rejects.toThrow("Injected provisioning failure");
    expect(await database.db.select().from(teams)).toHaveLength(2);
    expect(await database.db.select().from(teamMembers)).toHaveLength(3);
    expect(await database.db.select().from(chatSpaces)).toHaveLength(2);
  });
});
