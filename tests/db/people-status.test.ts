import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createStatusAction } from "@/features/people/status-action";
import { createChatQueries } from "@/features/chat/query-factory";
import { readAccountMenu } from "@/lib/dal/people-status";
import { createMemoryRealtime } from "@/lib/realtime/memory";
import { users, userBlocks, branchStaff, branches } from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";
import { seedChatActors, chatNow, type ChatActors } from "./chat-helper";

describe("persisted self status and private navigation metadata", () => {
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
  const action = (publisher = createMemoryRealtime()) =>
    createStatusAction({
      database: database.db,
      getSession: async () => actors.member,
      now: () => chatNow,
      publisher,
    });
  it.each(["online", "away", "dnd"] as const)(
    "stores %s and publishes only after committing",
    async (status) => {
      const publish = vi.fn(async () => {
        expect(
          (
            await database.db
              .select()
              .from(users)
              .where(eq(users.id, actors.member.userId))
          )[0]!.status,
        ).toBe(status);
      });
      const result = await createStatusAction({
        database: database.db,
        getSession: async () => actors.member,
        now: () => chatNow,
        publisher: { publish, publishMany: vi.fn() },
      })({ status });
      expect(result).toEqual({ ok: true, data: { status } });
      expect(publish).toHaveBeenCalledExactlyOnceWith(
        `user:${actors.member.userId}`,
        { type: "status.changed", status },
      );
    },
  );
  it("checks session before input and rejects every non-persisted status", async () => {
    const result = await createStatusAction({ getSession: async () => null })({
      status: "offline",
    });
    expect(result).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    for (const status of ["offline", "unknown", "", null])
      expect(await action()({ status })).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
    expect(
      await action()({ status: "dnd", userId: actors.admin.userId }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });
  it("keeps a committed status if publishing fails and logs no private values", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(
        await createStatusAction({
          database: database.db,
          getSession: async () => actors.member,
          publisher: {
            publish: async () => {
              throw new Error("secret-token");
            },
            publishMany: vi.fn(),
          },
        })({ status: "dnd" }),
      ).toEqual({ ok: true, data: { status: "dnd" } });
      expect(log).toHaveBeenCalledExactlyOnceWith(
        "Status update publication failed.",
      );
    } finally {
      log.mockRestore();
    }
  });
  it("returns status and own blocks even without any team, in the unchanged two-statement nav budget", async () => {
    await database.db
      .update(users)
      .set({ status: "dnd" })
      .where(eq(users.id, actors.operator.userId));
    await database.db
      .insert(userBlocks)
      .values({
        blockerId: actors.operator.userId,
        blockedId: actors.member.userId,
      });
    await database.db
      .insert(userBlocks)
      .values({
        blockerId: actors.admin.userId,
        blockedId: actors.operator.userId,
      });
    const queries = createChatQueries({
      database: database.db,
      requireSession: async () => actors.operator,
      now: () => chatNow,
    });
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const value = await queries.getMyChatNav();
      const measurement = meter.stop();
      expect(value).toEqual({
        spaces: [],
        directMessages: [],
        myStatus: "dnd",
        blockedUserIds: [actors.member.userId],
      });
      expect(measurement.perStage).toEqual([2]);
    } finally {
      meter.restore();
    }
  });
  it("reads menu status username and operator presence in one statement", async () => {
    await database.db
      .update(users)
      .set({ status: "away", username: "floor.member" })
      .where(eq(users.id, actors.member.userId));
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const value = await readAccountMenu(actors.member.userId, database.db);
      const measurement = meter.stop();
      expect(value).toEqual({
        myStatus: "away",
        username: "floor.member",
        isOperator: false,
      });
      expect(measurement.perStage).toEqual([1]);
    } finally {
      meter.restore();
    }
    const [branch] = await database.db
      .insert(branches)
      .values({
        name: "가상 상태점",
        address: "가상 주소",
        timezone: "Asia/Seoul",
      })
      .returning();
    await database.db
      .insert(branchStaff)
      .values({ branchId: branch!.id, userId: actors.member.userId });
    expect(
      (await readAccountMenu(actors.member.userId, database.db))?.isOperator,
    ).toBe(true);
  });
});
