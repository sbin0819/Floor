import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCurrentSessionId, getSession } from "@/lib/auth/session";

const mocks = vi.hoisted(() => ({
  request: 0,
  headers: vi.fn(),
  auth: vi.fn(),
  read: vi.fn(),
}));
vi.mock("react", () => ({
  cache: <T>(fn: () => T) => {
    let request = -1;
    let value: T;
    return () => {
      if (request !== mocks.request) {
        request = mocks.request;
        value = fn();
      }
      return value;
    };
  },
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth/auth", () => ({ getAuth: mocks.auth }));
vi.mock("@/lib/dal", () => ({ getOperatorBranches: vi.fn() }));
beforeEach(() => {
  mocks.request += 1;
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(
    new Headers({ cookie: "better-auth.session_token=private-token" }),
  );
  mocks.auth.mockReturnValue({ api: { getSession: mocks.read } });
  mocks.read.mockResolvedValue({
    user: { id: "user", name: "회원", email: "test@example.com" },
    session: { id: "session", token: "private-token", ipAddress: "192.0.2.1" },
  });
});
describe("private request-scoped raw session", () => {
  it("shares one raw read with the unchanged public contract", async () => {
    const [session, id] = await Promise.all([
      getSession(),
      getCurrentSessionId(),
    ]);
    expect(session).toEqual({
      userId: "user",
      name: "회원",
      email: "test@example.com",
    });
    expect(id).toBe("session");
    expect(await getCurrentSessionId()).toBe(id);
    expect(mocks.read).toHaveBeenCalledTimes(1);
    expect(mocks.headers).toHaveBeenCalledTimes(1);
  });
  it("does not reuse another request's session", async () => {
    expect(await getCurrentSessionId()).toBe("session");
    mocks.request += 1;
    mocks.read.mockResolvedValue(null);
    expect(await getSession()).toBeNull();
    expect(await getCurrentSessionId()).toBeNull();
    expect(mocks.read).toHaveBeenCalledTimes(2);
  });
  it("does not initialize authentication for either read without its cookie", async () => {
    mocks.headers.mockResolvedValue(new Headers());
    expect(await getCurrentSessionId()).toBeNull();
    expect(await getSession()).toBeNull();
    expect(mocks.auth).not.toHaveBeenCalled();
  });
});
