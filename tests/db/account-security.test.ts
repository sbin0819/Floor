import { randomUUID } from "node:crypto";
import { createRequestStore } from "next/dist/server/async-storage/request-store";
import { createWorkStore } from "next/dist/server/async-storage/work-store";
import { workAsyncStorage } from "next/dist/server/app-render/work-async-storage.external";
import { workUnitAsyncStorage } from "next/dist/server/app-render/work-unit-async-storage.external";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { APIError } from "better-auth/api";
import { createAccountSecurity } from "@/lib/auth/account-security";
import { authSessions, notifications, users } from "@/lib/db/schema";
import {
  authRequest,
  createAuthTestHarness,
  login,
  responseCookie,
  signup,
  socialLogin,
  testPassword,
  verifyLastEmail,
  type AuthTestHarness,
} from "./auth-helper";

vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  vi.stubGlobal("AsyncLocalStorage", AsyncLocalStorage);
});

describe("account security through the real Better Auth adapter", () => {
  let harness: AuthTestHarness;
  let cookie: string;
  let userId: string;
  let currentId: string;
  let now: Date;
  beforeAll(async () => {
    harness = await createAuthTestHarness();
  });
  afterAll(async () => {
    await harness.client.close();
    vi.unstubAllGlobals();
  });
  beforeEach(async () => {
    // 가입 훅이 남긴 환영 알림이 계정을 참조한다.
    await harness.db.delete(notifications);
    await harness.db.delete(users);
    harness.email.messages.length = 0;
    await signup(harness.auth);
    await verifyLastEmail(harness);
    cookie = responseCookie(await login(harness.auth));
    const result = await harness.auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    userId = result!.user.id;
    currentId = result!.session.id;
    now = new Date();
  });
  function security() {
    return createAccountSecurity({
      auth: harness.auth,
      headers: async () => new Headers({ cookie }),
      currentSessionId: async () => currentId,
      now: () => now,
    });
  }
  async function anotherSession() {
    const anotherCookie = responseCookie(await login(harness.auth));
    const result = await harness.auth.api.getSession({
      headers: new Headers({ cookie: anotherCookie }),
    });
    return { cookie: anotherCookie, session: result!.session };
  }

  it("lists old sessions despite freshAge, sorts current first, and exposes only safe device metadata", async () => {
    const other = await anotherSession();
    const older = new Date(now.getTime() - 2 * 86400000);
    await harness.db
      .update(authSessions)
      .set({
        createdAt: older,
        updatedAt: older,
        ipAddress: "192.0.2.77",
        userAgent: "private-agent Chrome/130.0 (Windows NT 10.0)",
      })
      .where(eq(authSessions.id, currentId));
    await expect(
      harness.auth.api.listSessions({ headers: new Headers({ cookie }) }),
    ).rejects.toMatchObject({ body: { code: "SESSION_NOT_FRESH" } });
    const result = await security().listMySessions(userId);
    expect(result.map(({ id }) => id)).toEqual([currentId, other.session.id]);
    expect(result[0]).toEqual({
      id: currentId,
      browser: "Chrome",
      os: "Windows",
      device: "desktop",
      createdAt: older.toISOString(),
      updatedAt: older.toISOString(),
      current: true,
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(
      /token|ipAddress|userAgent|192\.0\.2|private-agent/,
    );
    expect(serialized).not.toContain(other.session.token);
  });

  it("excludes expiration at now and other people's sessions", async () => {
    const other = await anotherSession();
    await harness.db
      .update(authSessions)
      .set({ expiresAt: now })
      .where(eq(authSessions.id, other.session.id));
    await signup(harness.auth, "other@example.com");
    await verifyLastEmail(harness);
    await login(harness.auth, "other@example.com");
    expect(
      (await security().listMySessions(userId)).map(({ id }) => id),
    ).toEqual([currentId]);
  });

  it("does not truncate sessions at the adapter's default 100 and revokes every other active session", async () => {
    await harness.db.insert(authSessions).values(
      Array.from({ length: 104 }, (_, i) => ({
        id: randomUUID(),
        userId,
        token: `private-extra-token-${i}`,
        expiresAt: new Date(now.getTime() + 86400000),
        createdAt: new Date(now.getTime() - 100000),
        updatedAt: new Date(now.getTime() + i),
      })),
    );
    expect(
      await (await harness.auth.$context).internalAdapter.listSessions(userId),
    ).toHaveLength(100);
    expect(await security().listMySessions(userId)).toHaveLength(105);
    await security().revokeMyOtherSessions(userId);
    expect(
      (await harness.db.select().from(authSessions)).map(({ id }) => id),
    ).toEqual([currentId]);
    expect(
      await harness.auth.api.getSession({ headers: new Headers({ cookie }) }),
    ).not.toBeNull();
  });

  it("revokes only an owned non-current session by id and invalidates its cookie", async () => {
    const other = await anotherSession();
    await expect(
      security().revokeMySession(userId, currentId),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(
      security().revokeMySession(userId, randomUUID()),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await signup(harness.auth, "other@example.com");
    await verifyLastEmail(harness);
    const foreignCookie = responseCookie(
      await login(harness.auth, "other@example.com"),
    );
    const foreign = await harness.auth.api.getSession({
      headers: new Headers({ cookie: foreignCookie }),
    });
    await expect(
      security().revokeMySession(userId, foreign!.session.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await security().revokeMySession(userId, other.session.id);
    expect(
      await harness.auth.api.getSession({
        headers: new Headers({ cookie: other.cookie }),
      }),
    ).toBeNull();
    expect(
      await harness.auth.api.getSession({ headers: new Headers({ cookie }) }),
    ).not.toBeNull();
    expect(
      await harness.auth.api.getSession({
        headers: new Headers({ cookie: foreignCookie }),
      }),
    ).not.toBeNull();
  });

  it("refuses to revoke when the request no longer identifies an active owned session", async () => {
    const missing = createAccountSecurity({
      auth: harness.auth,
      currentSessionId: async () => null,
      now: () => now,
    });
    await expect(missing.revokeMyOtherSessions(userId)).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(await security().listMySessions(userId)).toHaveLength(1);
  });

  it("returns only supported login provider identifiers", async () => {
    expect(await security().listMyProviders(userId)).toEqual(["credential"]);
    harness.identity.email = "member@example.com";
    await socialLogin(harness.auth, "google");
    await socialLogin(harness.auth, "github");
    expect(await security().listMyProviders(userId)).toEqual([
      "google",
      "github",
    ]);
  });

  it("maps incorrect passwords by API error code and never changes sessions", async () => {
    await expect(
      security().changeMyPassword({
        currentPassword: "incorrect-secret",
        newPassword: "new-password-123",
        revokeOtherSessions: true,
      }),
    ).rejects.toMatchObject({
      code: "PASSWORD_INCORRECT",
      message: "PASSWORD_INCORRECT",
    });
    expect(await security().listMySessions(userId)).toHaveLength(1);
    expect((await login(harness.auth)).status).toBe(200);
  });

  it("rejects a social-only account without creating credentials", async () => {
    const signedIn = await socialLogin(harness.auth, "google");
    const socialCookie = responseCookie(signedIn);
    const social = createAccountSecurity({
      auth: harness.auth,
      headers: async () => new Headers({ cookie: socialCookie }),
    });
    await expect(
      social.changeMyPassword({
        currentPassword: testPassword,
        newPassword: "new-password-123",
        revokeOtherSessions: true,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("changes the password without revoking sessions when the option is off", async () => {
    const other = await anotherSession();
    await harness.db
      .update(authSessions)
      .set({ createdAt: new Date(now.getTime() - 2 * 86400000) })
      .where(eq(authSessions.id, currentId));
    expect(
      await security().changeMyPassword({
        currentPassword: testPassword,
        newPassword: "new-password-123",
        revokeOtherSessions: false,
      }),
    ).toBeUndefined();
    expect(await security().listMySessions(userId)).toHaveLength(2);
    expect(
      await harness.auth.api.getSession({
        headers: new Headers({ cookie: other.cookie }),
      }),
    ).not.toBeNull();
    expect(
      (await login(harness.auth, "member@example.com", testPassword)).status,
    ).toBe(401);
    expect(
      (await login(harness.auth, "member@example.com", "new-password-123"))
        .status,
    ).toBe(200);
  });

  it("passes the rotated cookie through the installed nextCookies plugin and exposes no token", async () => {
    const other = await anotherSession();
    const onUpdateCookies = vi.fn();
    const requestStore = createRequestStore({
      phase: "action",
      headers: new Headers({ cookie, "next-action": "account-security-test" }),
      url: { pathname: "/settings/account" },
      onUpdateCookies,
      rootParams: {},
      implicitTags: { tags: [], expirationsByCacheKind: new Map() },
      resumeDataCache: null,
      previewProps: undefined,
      isHmrRefresh: false,
      serverComponentsHmrCache: undefined,
      hmrRefreshHash: undefined,
      fallbackParams: null,
    });
    const workStore = createWorkStore({
      page: "/settings/account/page",
      buildId: "test",
      deploymentId: "test",
      previouslyRevalidatedTags: [],
      renderOpts: {
        cacheLifeProfiles: { default: { stale: 0, revalidate: 0, expire: 1 } },
        staticPageGenerationTimeout: 60,
        cacheComponents: true,
        validationLevel: "warning",
        isPossibleServerAction: true,
        supportsDynamicResponse: true,
        isDraftMode: false,
        isBuildTimePrerendering: false,
        isDebugDynamicAccesses: false,
        assetPrefix: "",
        waitUntil: undefined,
        onClose: vi.fn(),
        onAfterTaskError: undefined,
        experimental: {
          isRoutePPREnabled: false,
          authInterrupts: false,
          useCacheTimeout: 60,
        },
      },
    });
    const result = await workAsyncStorage.run(workStore, () =>
      workUnitAsyncStorage.run(requestStore, () =>
        security().changeMyPassword({
          currentPassword: testPassword,
          newPassword: "new-password-123",
          revokeOtherSessions: true,
        }),
      ),
    );
    expect(result).toBeUndefined();
    const cookieWrite = requestStore.mutableCookies.get(
      "better-auth.session_token",
    );
    expect(cookieWrite).toBeDefined();
    expect(cookieWrite).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    expect(onUpdateCookies).toHaveBeenCalled();
    const sentCookies: string[] = onUpdateCookies.mock.lastCall![0];
    const newCookie = sentCookies
      .map((value) => value.split(";")[0])
      .join("; ");
    expect(
      await harness.auth.api.getSession({ headers: new Headers({ cookie }) }),
    ).toBeNull();
    expect(
      await harness.auth.api.getSession({
        headers: new Headers({ cookie: other.cookie }),
      }),
    ).toBeNull();
    const current = await harness.auth.api.getSession({
      headers: new Headers({ cookie: newCookie }),
    });
    expect(current?.user.id).toBe(userId);
    expect(current?.session.id).not.toBe(currentId);
    expect(await harness.db.select().from(authSessions)).toHaveLength(1);
  });

  it.each(["/list-sessions", "/change-password"])(
    "keeps HTTP %s disabled",
    async (path) => {
      const body =
        path === "/change-password"
          ? {
              currentPassword: testPassword,
              newPassword: "new-password-123",
              revokeOtherSessions: true,
            }
          : undefined;
      expect((await authRequest(harness.auth, path, body, cookie)).status).toBe(
        404,
      );
    },
  );

  it("does not classify or expose an arbitrary library error by its message text", async () => {
    const change = vi
      .spyOn(harness.auth.api, "changePassword")
      .mockRejectedValueOnce(
        new APIError("BAD_REQUEST", {
          code: "UNEXPECTED",
          message: "INVALID_PASSWORD private-password private-token",
        }),
      );
    try {
      await expect(
        security().changeMyPassword({
          currentPassword: testPassword,
          newPassword: "new-password-123",
          revokeOtherSessions: true,
        }),
      ).rejects.toMatchObject({ code: "INTERNAL", message: "INTERNAL" });
    } finally {
      change.mockRestore();
    }
  });
});
