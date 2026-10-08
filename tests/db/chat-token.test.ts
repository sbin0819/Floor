import type { TokenParams, TokenRequest } from "ably";
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
  createRealtimeToken,
  RealtimeDisabledError,
  type RealtimeTokenDependencies,
} from "@/features/chat/realtime-token";
import { ActionError } from "@/lib/actions/result";
import { chatSpaces, teamMembers } from "@/lib/db/schema";
import {
  createMemoryRateLimiter,
  RateLimitError,
} from "@/lib/rate-limit/memory";
import { createTestDatabase, type TestDatabase } from "./helper";
import { chatNow, seedChatActors, type ChatActors } from "./chat-helper";

describe("realtime token capabilities", () => {
  let database: TestDatabase;
  let actors: ChatActors;
  const request = vi.fn(async (params: TokenParams): Promise<TokenRequest> => ({
    capability: JSON.stringify(params.capability),
    clientId: params.clientId,
    ttl: params.ttl,
    timestamp: chatNow.getTime(),
    keyName: "public-key-name",
    mac: "fake-mac",
    nonce: "fake-nonce-01234567",
  }));
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    request.mockClear();
    await database.db.execute(sql`truncate users, branches cascade`);
    actors = await seedChatActors(database);
  });
  const token = (overrides: RealtimeTokenDependencies = {}) =>
    createRealtimeToken({
      database: database.db,
      requireSession: async () => actors.member,
      getKey: () => "fake-only",
      createTokenRequest: request,
      limiter: createMemoryRateLimiter(() => chatNow.getTime()),
      ...overrides,
    });

  it("grants only the caller user channel and readable room subscription/presence, for ten minutes", async () => {
    const value = await token()({
      rooms: [actors.roomId, actors.roomId, actors.otherSpace.roomId],
    });
    expect(JSON.parse(value.capability)).toEqual({
      [`user:${actors.member.userId}`]: ["subscribe"],
      [`room:${actors.roomId}`]: ["subscribe", "presence"],
    });
    expect(value.clientId).toBe(actors.member.userId);
    expect(value.ttl).toBe(600_000);
    expect(value.capability).not.toMatch(/publish|\*/);
    expect(JSON.stringify(value)).not.toContain("@");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("allows an empty room list but never grants an operator private team access", async () => {
    const value = await token({ requireSession: async () => actors.operator })({
      rooms: [actors.roomId],
    });
    expect(JSON.parse(value.capability)).toEqual({
      [`user:${actors.operator.userId}`]: ["subscribe"],
    });
    expect(await token()({ rooms: [] })).toMatchObject({
      clientId: actors.member.userId,
    });
  });
  it("grants only the selected readable space without presence or publish capabilities", async () => {
    const value = await token()({
      rooms: [actors.roomId],
      spaces: [actors.spaceId],
    });
    expect(JSON.parse(value.capability)).toEqual({
      [`user:${actors.member.userId}`]: ["subscribe"],
      [`room:${actors.roomId}`]: ["subscribe", "presence"],
      [`space:${actors.spaceId}`]: ["subscribe"],
    });
    expect(value.clientId).toBe(actors.member.userId);
    expect(value.ttl).toBe(600_000);
    expect(value.capability).not.toMatch(/publish|\*/);
    const foreign = await token()({
      rooms: [],
      spaces: [actors.otherSpace.spaceId],
    });
    expect(JSON.parse(foreign.capability)).toEqual({
      [`user:${actors.member.userId}`]: ["subscribe"],
    });
    const operator = await token({
      requireSession: async () => actors.operator,
    })({ rooms: [], spaces: [actors.spaceId] });
    expect(JSON.parse(operator.capability)).toEqual({
      [`user:${actors.operator.userId}`]: ["subscribe"],
    });
  });
  it("omits a previously readable space after membership removal or deletion", async () => {
    await database.db
      .delete(teamMembers)
      .where(eq(teamMembers.userId, actors.member.userId));
    expect(
      JSON.parse(
        (await token()({ rooms: [], spaces: [actors.spaceId] })).capability,
      ),
    ).not.toHaveProperty(`space:${actors.spaceId}`);
    await database.db
      .update(chatSpaces)
      .set({ deletedAt: chatNow })
      .where(eq(chatSpaces.id, actors.spaceId));
    const value = await token({ requireSession: async () => actors.admin })({
      rooms: [],
      spaces: [actors.spaceId],
    });
    expect(JSON.parse(value.capability)).not.toHaveProperty(
      `space:${actors.spaceId}`,
    );
  });
  it("checks the current membership and deleted state on every request", async () => {
    await database.db
      .delete(teamMembers)
      .where(eq(teamMembers.userId, actors.member.userId));
    expect(
      JSON.parse((await token()({ rooms: [actors.roomId] })).capability),
    ).not.toHaveProperty(`room:${actors.roomId}`);
    await database.db
      .update(chatSpaces)
      .set({ deletedAt: chatNow })
      .where(eq(chatSpaces.id, actors.spaceId));
    expect(
      JSON.parse(
        (
          await token({ requireSession: async () => actors.admin })({
            rooms: [actors.roomId],
          })
        ).capability,
      ),
    ).not.toHaveProperty(`room:${actors.roomId}`);
  });
  it("rejects unauthenticated callers before parsing the body or checking key configuration", async () => {
    const body = vi.fn();
    const key = vi.fn();
    await expect(
      token({
        requireSession: async () => {
          throw new ActionError("UNAUTHENTICATED");
        },
        getKey: key,
      })(body),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(body).not.toHaveBeenCalled();
    expect(key).not.toHaveBeenCalled();
    await expect(
      token({ getKey: () => undefined })({ rooms: [] }),
    ).rejects.toBeInstanceOf(RealtimeDisabledError);
  });
  it.each([
    null,
    {},
    { rooms: ["invalid"] },
    { rooms: Array.from({ length: 4 }, () => crypto.randomUUID()) },
    { rooms: [], userId: "foreign" },
    { rooms: [], spaces: ["invalid"] },
    { rooms: [], spaces: [crypto.randomUUID(), crypto.randomUUID()] },
  ])("rejects malformed input without issuing a token", async (input) => {
    await expect(token()(input)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(request).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON and rate-limits requests with a retry duration", async () => {
    await expect(
      token()(async () => {
        throw new SyntaxError("bad JSON");
      }),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    const read = token();
    for (let index = 0; index < 30; index++) await read({ rooms: [] });
    await expect(read({ rooms: [] })).rejects.toMatchObject({ retryAfter: 60 });
    await expect(read({ rooms: [] })).rejects.toBeInstanceOf(RateLimitError);
    expect(request).toHaveBeenCalledTimes(30);
  });
});
