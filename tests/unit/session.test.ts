import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSession,
  requireOperatorPage,
  requirePageSession,
  requireSession,
} from "@/lib/auth/session";

const mocks = vi.hoisted(() => ({
  headers: vi.fn(),
  getAuth: vi.fn(),
  readSession: vi.fn(),
  getOperatorBranches: vi.fn(),
  redirect: vi.fn((url: string): never => {
    throw new Error(`redirect:${url}`);
  }),
}));
vi.mock("next/headers", () => ({ headers: mocks.headers }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/auth/auth", () => ({ getAuth: mocks.getAuth }));
vi.mock("@/lib/dal", () => ({
  getOperatorBranches: mocks.getOperatorBranches,
}));

const profile = {
  id: "8b11dca4-a05e-4be6-9b05-e4a40e1f23a6",
  email: "member@example.test",
  name: "회원",
  emailVerified: true,
};
const appSession = {
  userId: profile.id,
  email: profile.email,
  name: profile.name,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.headers.mockResolvedValue(
    new Headers({ cookie: "better-auth.session_token=test-token" }),
  );
  mocks.getAuth.mockReturnValue({ api: { getSession: mocks.readSession } });
  mocks.readSession.mockResolvedValue({
    user: profile,
    session: { token: "never-exposed" },
  });
  mocks.getOperatorBranches.mockResolvedValue([
    { id: "branch", name: "가상 지점" },
  ]);
});

describe("Better Auth session boundary", () => {
  it("returns null without constructing auth when the cookie is absent", async () => {
    mocks.headers.mockResolvedValue(new Headers());
    expect(await getSession()).toBeNull();
    expect(mocks.getAuth).not.toHaveBeenCalled();
  });
  it("ignores unrelated cookies", async () => {
    mocks.headers.mockResolvedValue(
      new Headers({ cookie: "preference=light" }),
    );
    expect(await getSession()).toBeNull();
    expect(mocks.getAuth).not.toHaveBeenCalled();
  });
  it("forwards request headers and returns only the app session contract", async () => {
    expect(await getSession()).toEqual(appSession);
    expect(mocks.readSession).toHaveBeenCalledExactlyOnceWith({
      headers: await mocks.headers(),
    });
  });
  it("reads again with the same result outside a React server render", async () => {
    const first = await getSession();
    expect(await getSession()).toEqual(first);
    expect(mocks.readSession).toHaveBeenCalledTimes(2);
    expect(mocks.headers).toHaveBeenCalledTimes(2);
  });
  it("recognizes the secure production cookie", async () => {
    mocks.headers.mockResolvedValue(
      new Headers({ cookie: "__Secure-better-auth.session_token=test-token" }),
    );
    expect(await getSession()).toEqual(appSession);
  });
  it("returns null for an invalid or expired cookie without redirecting", async () => {
    mocks.readSession.mockResolvedValue(null);
    expect(await getSession()).toBeNull();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });
  it("does not hide database failures as anonymous sessions", async () => {
    mocks.readSession.mockRejectedValue(new Error("database unavailable"));
    await expect(getSession()).rejects.toThrow("database unavailable");
  });
  it("requires a session for actions and queries", async () => {
    expect(await requireSession()).toEqual(appSession);
    mocks.readSession.mockResolvedValue(null);
    await expect(requireSession()).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });
  it("redirects anonymous pages with a safe return destination", async () => {
    mocks.readSession.mockResolvedValue(null);
    await expect(requirePageSession("/invite/abc?x=1")).rejects.toThrow(
      "redirect:/login?next=%2Finvite%2Fabc%3Fx%3D1",
    );
    await expect(requirePageSession("https://evil.test")).rejects.toThrow(
      "redirect:/login?next=%2F",
    );
  });
  it("returns signed-in page sessions", async () => {
    expect(await requirePageSession("/")).toEqual(appSession);
  });
  it("redirects anonymous operators to their sign-in page", async () => {
    mocks.readSession.mockResolvedValue(null);
    await expect(requireOperatorPage()).rejects.toThrow(
      "redirect:/admin/login",
    );
    expect(mocks.getOperatorBranches).not.toHaveBeenCalled();
  });
  it("rejects a signed-in user without any operator membership", async () => {
    mocks.getOperatorBranches.mockResolvedValue([]);
    await expect(requireOperatorPage()).rejects.toThrow(
      "redirect:/admin/login?error=not_operator",
    );
  });
  it("allows an operator based on fresh DAL membership", async () => {
    expect(await requireOperatorPage()).toEqual(appSession);
    expect(mocks.getOperatorBranches).toHaveBeenCalledWith(profile.id);
  });
});
