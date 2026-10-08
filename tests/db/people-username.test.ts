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
import {
  createUsernameAction,
  createUsernameQuery,
} from "@/features/people/username";
import { users } from "@/lib/db/schema";
import { USERNAME_COOLDOWN_MS } from "@/lib/people/username";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

const now = new Date("2026-10-08T03:00:00Z");
const session = {
  userId: "71000000-0000-4000-8000-000000000001",
  name: "김하은",
  email: "haeun+work@example.test",
};
const other = "71000000-0000-4000-8000-000000000002";
describe("username actions and settings", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`truncate users, branches cascade`);
    await database.db.insert(users).values([
      {
        id: session.userId,
        name: session.name,
        email: session.email,
        emailVerified: true,
      },
      {
        id: other,
        name: "이서연",
        email: "other@example.test",
        emailVerified: true,
        username: "haeun",
      },
    ]);
  });
  const action = (at = now) =>
    createUsernameAction({
      database: database.db,
      getSession: async () => session,
      now: () => at,
      logError: vi.fn(),
    });
  const settings = () =>
    createUsernameQuery({
      database: database.db,
      requireSession: async () => session,
      now: () => now,
    })();
  const read = async () =>
    (
      await database.db.select().from(users).where(eq(users.id, session.userId))
    )[0]!;

  it("allows initial choice and one immediate rename, then enforces 30 days", async () => {
    expect(await action()({ username: " @Haeun.Kim " })).toEqual({
      ok: true,
      data: { username: "haeun.kim" },
    });
    expect((await read()).usernameChangedAt).toBeNull();
    expect(await action()({ username: "haeun.k" })).toMatchObject({ ok: true });
    expect((await read()).usernameChangedAt).toEqual(now);
    expect(await action()({ username: "haeun.new" })).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "username_cooldown",
    });
    expect((await settings()).nextChangeAt).toBe(
      new Date(now.getTime() + USERNAME_COOLDOWN_MS).toISOString(),
    );
  });
  it("allows the exact 30 day boundary but not one millisecond earlier", async () => {
    await database.db
      .update(users)
      .set({ username: "haeun.k", usernameChangedAt: now })
      .where(eq(users.id, session.userId));
    expect(
      await action(new Date(now.getTime() + USERNAME_COOLDOWN_MS - 1))({
        username: "haeun.new",
      }),
    ).toMatchObject({ ok: false, message: "username_cooldown" });
    const boundary = new Date(now.getTime() + USERNAME_COOLDOWN_MS);
    expect(await action(boundary)({ username: "haeun.new" })).toMatchObject({
      ok: true,
    });
    expect((await read()).usernameChangedAt).toEqual(boundary);
  });
  it("makes identical normalized values a no-op including timestamps", async () => {
    await action()({ username: "haeun.kim" });
    await action()({ username: "haeun.k" });
    const previous = await read();
    expect(
      await action(new Date(now.getTime() + 1000))({ username: "@HAEUN.K" }),
    ).toMatchObject({ ok: true });
    expect(await read()).toEqual(previous);
  });
  it("maps the real unique violation and rolls back all username timestamps", async () => {
    const previous = await read();
    expect(await action()({ username: "haeun" })).toEqual({
      ok: false,
      code: "USERNAME_TAKEN",
    });
    expect(await read()).toEqual(previous);
  });
  it("validates input and session before writing", async () => {
    for (const username of ["everyone", "ab", "한글", "su-bin"])
      expect(await action()({ username })).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
    const anonymous = createUsernameAction({
      database: database.db,
      getSession: async () => null,
    });
    expect(await anonymous({ username: "valid" })).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect((await read()).username).toBeNull();
  });
  it("suggests the first unused name in one stage and two statements", async () => {
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const result = await settings();
      const measurement = meter.stop();
      expect(result).toMatchObject({
        username: null,
        suggestion: "haeun2",
        nextChangeAt: null,
        now: now.toISOString(),
      });
      expect(measurement).toEqual({
        stages: 1,
        statements: 2,
        perStage: [2],
      });
    } finally {
      meter.restore();
    }
    await action()({ username: "haeun.k" });
    expect((await settings()).suggestion).toBeNull();
  });
  it("rejects a stale session for a deleted user without leaking data", async () => {
    await database.db.delete(users).where(eq(users.id, session.userId));
    expect(await action()({ username: "unused" })).toEqual({
      ok: false,
      code: "NOT_FOUND",
    });
    await expect(settings()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
