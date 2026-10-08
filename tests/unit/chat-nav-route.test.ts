import { beforeEach, expect, it, vi } from "vitest";
import { ActionError } from "@/lib/actions/result";
import { GET } from "@/app/api/chat/nav/route";
const mocks = vi.hoisted(() => ({ connection: vi.fn(), query: vi.fn() }));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("@/features/chat/queries", () => ({ getMyChatNav: mocks.query }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.connection.mockResolvedValue(undefined);
});
it("returns the private navigation after the request boundary", async () => {
  mocks.query.mockResolvedValue({
    chatToasts: true,
    tabBadge: true,
    spaces: [],
    directMessages: [],
    myStatus: "online",
    blockedUserIds: [],
    meetings: [],
    now: "2026-10-08T03:00:00.000Z",
  });
  const result = await GET();
  expect(result.status).toBe(200);
  expect(await result.json()).toEqual({
    chatToasts: true,
    tabBadge: true,
    spaces: [],
    directMessages: [],
    myStatus: "online",
    blockedUserIds: [],
    meetings: [],
    now: "2026-10-08T03:00:00.000Z",
  });
  expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mocks.connection.mock.invocationCallOrder[0]).toBeLessThan(
    mocks.query.mock.invocationCallOrder[0]!,
  );
});
it.each([
  { error: new ActionError("UNAUTHENTICATED"), status: 401 },
  { error: new Error("private@example.test"), status: 500 },
])(
  "maps failures to $status without private details",
  async ({ error, status }) => {
    mocks.query.mockRejectedValue(error);
    const result = await GET();
    expect(result.status).toBe(status);
    expect(await result.text()).not.toContain("@");
    expect(result.headers.get("Cache-Control")).toBe("private, no-store");
  },
);
it("does not swallow the prerender boundary", async () => {
  mocks.connection.mockRejectedValue(new Error("boundary"));
  await expect(GET()).rejects.toThrow("boundary");
  expect(mocks.query).not.toHaveBeenCalled();
});
