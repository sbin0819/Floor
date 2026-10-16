import { beforeEach, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/actions/result";
import {
  createMemoryRateLimiter,
  RateLimitError,
} from "@/lib/rate-limit/memory";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  read: vi.fn(),
  publicRead: vi.fn(),
  connection: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  requireSession: mocks.session,
  getSession: mocks.session,
}));
vi.mock("@/lib/dal/people-read", () => ({ listMessageContacts: mocks.read }));
vi.mock("@/features/people/queries", () => ({
  getMessageContacts: mocks.publicRead,
}));
vi.mock("next/server", () => ({ connection: mocks.connection }));
import { createPeopleQueries } from "@/features/people/query-factory";
import { GET } from "@/app/api/people/contacts/route";
import { fetchMessageContacts } from "@/features/people/contacts-client";
import { contacts } from "./quick-switch-fixture";
beforeEach(() => {
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  mocks.session.mockResolvedValue({ userId: "a" });
  mocks.read.mockResolvedValue(contacts);
});
it("authenticates once and keeps the existing single DAL read contract", async () => {
  const queries = createPeopleQueries({
    rateLimiter: createMemoryRateLimiter(),
  });
  expect(await queries.getMessageContacts({ rateLimit: true })).toEqual(
    contacts,
  );
  expect(mocks.session).toHaveBeenCalledTimes(1);
  expect(mocks.read).toHaveBeenCalledExactlyOnceWith("a", undefined);
});
it("limits HTTP contacts to 30/min per user without throttling existing server page reads", async () => {
  let now = 0;
  const queries = createPeopleQueries({
    rateLimiter: createMemoryRateLimiter(() => now),
  });
  for (let n = 0; n < 30; n++)
    await queries.getMessageContacts({ rateLimit: true });
  await expect(
    queries.getMessageContacts({ rateLimit: true }),
  ).rejects.toBeInstanceOf(RateLimitError);
  expect(mocks.read).toHaveBeenCalledTimes(30);
  await queries.getMessageContacts();
  mocks.session.mockResolvedValue({ userId: "b" });
  await queries.getMessageContacts({ rateLimit: true });
  mocks.session.mockResolvedValue({ userId: "a" });
  now = 60_000;
  await queries.getMessageContacts({ rateLimit: true });
  expect(mocks.read).toHaveBeenCalledTimes(33);
});
it("rejects unauthenticated reads before DAL or limiter", async () => {
  mocks.session.mockRejectedValue(new ActionError("UNAUTHENTICATED"));
  const consume = vi.fn();
  await expect(
    createPeopleQueries({ rateLimiter: { consume } }).getMessageContacts({
      rateLimit: true,
    }),
  ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
  expect(consume).not.toHaveBeenCalled();
  expect(mocks.read).not.toHaveBeenCalled();
});
it("returns private contacts after the request boundary", async () => {
  mocks.publicRead.mockResolvedValue(contacts);
  const result = await GET();
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual(contacts);
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  expect(mocks.publicRead).toHaveBeenCalledExactlyOnceWith({ rateLimit: true });
  expect(mocks.connection.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.publicRead.mock.invocationCallOrder[0]!,
  );
});
it.each([
  [new ActionError("UNAUTHENTICATED"), 401, "UNAUTHENTICATED"],
  [new RateLimitError(42), 429, "RATE_LIMITED"],
  [new Error("private@example.test"), 500, "INTERNAL"],
])("maps HTTP failures without private text", async (error, status, code) => {
  mocks.publicRead.mockRejectedValue(error);
  const result = await GET();
  expect(result.status).toBe(status);
  expect(await result.json()).toEqual({ code });
  expect(result.headers.get("cache-control")).toBe("private, no-store");
  if (status === 429) expect(result.headers.get("retry-after")).toBe("42");
});
it("does not swallow the request boundary", async () => {
  mocks.connection.mockRejectedValue(new Error("boundary"));
  await expect(GET()).rejects.toThrow("boundary");
  expect(mocks.publicRead).not.toHaveBeenCalled();
});
it("fetches and validates contacts without caching HTTP responses", async () => {
  const fetch = vi.fn().mockResolvedValue(Response.json(contacts));
  vi.stubGlobal("fetch", fetch);
  const signal = new AbortController().signal;
  expect(await fetchMessageContacts(signal)).toEqual(contacts);
  expect(fetch).toHaveBeenCalledExactlyOnceWith(
    "/api/people/contacts",
    expect.objectContaining({
      signal: expect.any(AbortSignal),
      cache: "no-store",
      credentials: "same-origin",
      method: "GET",
    }),
  );
  fetch.mockResolvedValue(
    Response.json([{ ...contacts[0], email: "private@example.test" }]),
  );
  await expect(fetchMessageContacts(signal)).rejects.toThrow();
  fetch.mockResolvedValue(new Response("secret error", { status: 503 }));
  await expect(fetchMessageContacts(signal)).rejects.toMatchObject({
    kind: "http",
    status: 503,
  });
});
