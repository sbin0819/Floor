import { jwtVerify, SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ActionError } from "@/lib/actions/result";
import {
  clearSessionCookie,
  createSessionCookie,
  getSession,
  requireSession,
  sessionCookieName,
  sessionMaxAge,
} from "@/lib/auth/session";

const mocks = vi.hoisted(() => ({
  env: {
    AUTH_MODE: "demo",
    AUTH_SECRET: "test-secret-for-signed-demo-cookie",
    NODE_ENV: "test",
  },
  cookieValue: undefined as string | undefined,
  setCookie: vi.fn(),
  deleteCookie: vi.fn(),
  readCookies: vi.fn(),
  getUserById: vi.fn(),
}));

vi.mock("@/lib/env", () => ({ getEnv: () => mocks.env }));
vi.mock("@/lib/dal", () => ({ getUserById: mocks.getUserById }));
vi.mock("next/headers", () => ({ cookies: mocks.readCookies }));

const user = {
  id: crypto.randomUUID(),
  email: "member@example.test",
  name: "현재 이름",
};
const encoder = new TextEncoder();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.env.AUTH_MODE = "demo";
  mocks.env.AUTH_SECRET = "test-secret-for-signed-demo-cookie";
  mocks.env.NODE_ENV = "test";
  mocks.cookieValue = undefined;
  mocks.getUserById.mockResolvedValue(user);
  mocks.setCookie.mockImplementation((_name: string, value: string) => {
    mocks.cookieValue = value;
  });
  mocks.readCookies.mockResolvedValue({
    get: () =>
      mocks.cookieValue
        ? { name: sessionCookieName, value: mocks.cookieValue }
        : undefined,
    set: mocks.setCookie,
    delete: mocks.deleteCookie,
  });
});

describe("demo session", () => {
  it("creates a seven-day HS256 cookie with no trusted role or profile claims", async () => {
    await createSessionCookie(user.id);
    const token = mocks.cookieValue;
    expect(token).toBeDefined();
    if (!token) throw new Error("Expected the created cookie");
    const { payload, protectedHeader } = await jwtVerify(
      token,
      encoder.encode(mocks.env.AUTH_SECRET),
    );
    expect(protectedHeader.alg).toBe("HS256");
    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "sub"]);
    expect(payload.sub).toBe(user.id);
    expect(payload.exp! - payload.iat!).toBe(sessionMaxAge);
    expect(mocks.setCookie).toHaveBeenCalledWith(sessionCookieName, token, {
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: sessionMaxAge,
      expires: new Date(payload.exp! * 1000),
    });
    await expect(getSession()).resolves.toEqual({
      userId: user.id,
      email: user.email,
      name: user.name,
    });
    expect(mocks.getUserById).toHaveBeenCalledExactlyOnceWith(user.id);
  });

  it("requires HTTPS for production cookies", async () => {
    mocks.env.NODE_ENV = "production";
    await createSessionCookie(user.id);
    expect(mocks.setCookie).toHaveBeenCalledWith(
      sessionCookieName,
      expect.any(String),
      expect.objectContaining({ secure: true }),
    );
  });

  it("does not read cookies or query the database when demo mode is disabled", async () => {
    mocks.env.AUTH_MODE = "";
    await expect(getSession()).resolves.toBeNull();
    await expect(createSessionCookie(user.id)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    await clearSessionCookie();
    expect(mocks.readCookies).not.toHaveBeenCalled();
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });

  it("returns null when there is no cookie or the user no longer exists", async () => {
    await expect(getSession()).resolves.toBeNull();
    expect(mocks.getUserById).not.toHaveBeenCalled();
    await createSessionCookie(user.id);
    mocks.getUserById.mockResolvedValue(null);
    await expect(getSession()).resolves.toBeNull();
  });

  it.each([
    "tampered",
    "expired",
    "wrong-algorithm",
    "missing-expiration",
    "invalid-subject",
  ] as const)("rejects a %s token before a database read", async (kind) => {
    const now = Math.floor(Date.now() / 1000);
    let token = new SignJWT({})
      .setProtectedHeader({
        alg: kind === "wrong-algorithm" ? "HS384" : "HS256",
      })
      .setSubject(kind === "invalid-subject" ? "invalid-user-id" : user.id)
      .setIssuedAt(now - 60);
    if (kind !== "missing-expiration")
      token = token.setExpirationTime(kind === "expired" ? now - 1 : now + 60);
    mocks.cookieValue = await token.sign(
      encoder.encode(
        kind === "tampered" ? "wrong-secret" : mocks.env.AUTH_SECRET,
      ),
    );
    await expect(getSession()).resolves.toBeNull();
    expect(mocks.getUserById).not.toHaveBeenCalled();
  });

  it("loads the current profile instead of trusting profile claims in a cookie", async () => {
    mocks.cookieValue = await new SignJWT({
      email: "forged@example.test",
      name: "forged",
      role: "operator",
    })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(user.id)
      .setIssuedAt()
      .setExpirationTime("7d")
      .sign(encoder.encode(mocks.env.AUTH_SECRET));
    await expect(getSession()).resolves.toEqual({
      userId: user.id,
      email: user.email,
      name: user.name,
    });
  });

  it("does not disguise a database outage as an invalid session", async () => {
    await createSessionCookie(user.id);
    const error = new Error("database offline");
    mocks.getUserById.mockRejectedValue(error);
    await expect(getSession()).rejects.toBe(error);
  });

  it("requireSession returns the session or the known authentication error", async () => {
    await expect(requireSession()).rejects.toEqual(
      new ActionError("UNAUTHENTICATED"),
    );
    await createSessionCookie(user.id);
    await expect(requireSession()).resolves.toEqual({
      userId: user.id,
      email: user.email,
      name: user.name,
    });
  });

  it("clears the exact session cookie and rejects invalid creation subjects", async () => {
    await clearSessionCookie();
    expect(mocks.deleteCookie).toHaveBeenCalledExactlyOnceWith(
      sessionCookieName,
    );
    await expect(createSessionCookie("invalid-user-id")).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    expect(mocks.setCookie).not.toHaveBeenCalled();
  });
});
