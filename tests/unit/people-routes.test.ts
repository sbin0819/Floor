import { beforeEach, describe, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/actions/result";
import { RateLimitError } from "@/lib/rate-limit/memory";
const { search, profile, connection } = vi.hoisted(() => ({
  search: vi.fn(),
  profile: vi.fn(),
  connection: vi.fn(),
}));
vi.mock("@/features/people/queries", () => ({
  searchPeople: search,
  getPersonProfile: profile,
}));
vi.mock("next/server", () => ({ connection }));
import { GET as searchGET } from "@/app/api/people/search/route";
import { GET as profileGET } from "@/app/api/people/[userId]/route";

describe.each(["search", "profile"] as const)("people %s GET", (kind) => {
  const read = kind === "search" ? search : profile;
  const request = () =>
    kind === "search"
      ? searchGET(
          new Request("https://floor.test/api/people/search?q=%40haeun"),
        )
      : profileGET(new Request("https://floor.test/api/people/person-id"), {
          params: Promise.resolve({ userId: "person-id" }),
        });
  beforeEach(() => vi.resetAllMocks());
  it("enters the request boundary first and returns a private response", async () => {
    const data =
      kind === "search"
        ? [{ userId: "a", name: "하은" }]
        : { userId: "a", name: "하은" };
    read.mockResolvedValue(data);
    const result = await request();
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual(
      kind === "search" ? { results: data } : data,
    );
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(connection.mock.invocationCallOrder[0]).toBeLessThan(
      read.mock.invocationCallOrder[0]!,
    );
    expect(read).toHaveBeenCalledExactlyOnceWith(
      kind === "search" ? "@haeun" : "person-id",
    );
  });
  it.each([
    [new ActionError("UNAUTHENTICATED"), 401, "UNAUTHENTICATED"],
    [new ActionError("INVALID_INPUT"), 400, "INVALID_INPUT"],
    [new ActionError("NOT_FOUND"), 404, "NOT_FOUND"],
    [new Error("secret private@example.test"), 500, "INTERNAL"],
  ])(
    "hides original errors and never redirects",
    async (error, status, code) => {
      read.mockRejectedValue(error);
      const result = await request();
      expect(result.status).toBe(status);
      expect(await result.json()).toEqual({ code });
      expect(result.headers.get("cache-control")).toBe("private, no-store");
      expect(result.headers.get("location")).toBeNull();
    },
  );
  it("returns Retry-After for rate limits", async () => {
    read.mockRejectedValue(new RateLimitError(42));
    const result = await request();
    expect(result.status).toBe(429);
    expect(result.headers.get("retry-after")).toBe("42");
    expect(await result.json()).toEqual({ code: "RATE_LIMITED" });
  });
  it("does not swallow a prerender boundary or start a reader before it", async () => {
    const error = new Error("request boundary");
    connection.mockRejectedValue(error);
    await expect(request()).rejects.toBe(error);
    expect(read).not.toHaveBeenCalled();
  });
});
