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
import { z } from "zod";
import { createEmailVerificationToken } from "better-auth/api";
import { createAuth, disabledAuthPaths } from "@/lib/auth/auth";
import {
  authAccounts,
  authSessions,
  authVerifications,
  notifications,
  users,
} from "@/lib/db/schema";
import {
  authBaseUrl,
  authRequest,
  authTestSecret,
  createAuthTestHarness,
  emailLink,
  login,
  responseCookie,
  signup,
  socialIdentity,
  socialLogin,
  testPassword,
  verifyLastEmail,
  type AuthTestHarness,
} from "./auth-helper";

const signupResponse = z.object({
  token: z.null(),
  user: z.object({
    id: z.uuid(),
    email: z.email(),
    emailVerified: z.boolean(),
    name: z.string(),
    image: z.nullable(z.string()),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
});

describe("Better Auth with real Drizzle migrations and PGlite", () => {
  let harness: AuthTestHarness;
  beforeAll(async () => {
    harness = await createAuthTestHarness();
  });
  afterAll(async () => {
    await harness.client.close();
  });
  beforeEach(async () => {
    await harness.db.delete(authVerifications);
    // 가입 훅이 남긴 환영 알림이 계정을 참조한다.
    await harness.db.delete(notifications);
    await harness.db.delete(users);
    harness.email.messages.length = 0;
    Object.assign(harness.identity, socialIdentity());
  });

  it("requires verification, never signs in after verification, and supports login/session/logout", async () => {
    const created = await signup(harness.auth, "Member@Example.COM");
    expect(created.status).toBe(200);
    const body = signupResponse.parse(await created.json());
    expect(body.user).toMatchObject({
      email: "member@example.com",
      emailVerified: false,
      name: "회원 이름",
    });
    expect(responseCookie(created)).not.toContain("session_token");
    const rejected = await login(harness.auth);
    expect(rejected.status).toBe(403);
    expect(await rejected.json()).toMatchObject({ code: "EMAIL_NOT_VERIFIED" });
    expect(emailLink(harness).searchParams.get("callbackURL")).toBe(
      `${authBaseUrl}/login?verified=1`,
    );
    const verified = await verifyLastEmail(harness);
    expect(verified.headers.get("location")).toBe(
      `${authBaseUrl}/login?verified=1`,
    );
    expect(responseCookie(verified)).not.toContain("session_token");
    const signedIn = await login(harness.auth);
    expect(signedIn.status).toBe(200);
    const cookie = responseCookie(signedIn);
    expect(cookie).toContain("better-auth.session_token=");
    const session = await harness.auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    expect(session?.user).toMatchObject({
      id: body.user.id,
      email: "member@example.com",
      name: "회원 이름",
    });
    const user = await harness.db.select().from(users);
    expect(user[0]?.emailVerified).toBe(true);
    const stored = (await harness.db.select().from(authSessions))[0];
    expect(stored).toBeDefined();
    expect(
      stored!.expiresAt.getTime() - stored!.createdAt.getTime(),
    ).toBeGreaterThan(6.99 * 86400000);
    expect(
      stored!.expiresAt.getTime() - stored!.createdAt.getTime(),
    ).toBeLessThanOrEqual(7 * 86400000);
    expect(
      (await authRequest(harness.auth, "/sign-out", {}, cookie)).status,
    ).toBe(200);
    expect(
      await harness.auth.api.getSession({ headers: new Headers({ cookie }) }),
    ).toBeNull();
  });

  it("returns generic UUID success for duplicate case-insensitive signups without changing the password", async () => {
    const first = signupResponse.parse(
      await (await signup(harness.auth)).json(),
    );
    const originalPassword = (await harness.db.select().from(authAccounts))[0]
      ?.password;
    harness.email.messages.length = 0;
    const duplicate = await signup(
      harness.auth,
      "MEMBER@EXAMPLE.COM",
      "different-password",
    );
    expect(duplicate.status).toBe(200);
    const second = signupResponse.parse(await duplicate.json());
    expect(second.user.id).not.toBe(first.user.id);
    expect(Object.keys(second).sort()).toEqual(Object.keys(first).sort());
    expect(Object.keys(second.user).sort()).toEqual(
      Object.keys(first.user).sort(),
    );
    expect(await harness.db.select().from(users)).toHaveLength(1);
    expect((await harness.db.select().from(authAccounts))[0]?.password).toBe(
      originalPassword,
    );
    expect(harness.email.messages).toHaveLength(1);
    expect(harness.email.messages[0]?.subject).toContain("비밀번호");
  });

  it("sends one existing-account notice for a verified duplicate and preserves the original password", async () => {
    await signup(harness.auth);
    await verifyLastEmail(harness);
    harness.email.messages.length = 0;
    const duplicate = await signup(
      harness.auth,
      "MEMBER@example.com",
      "different-password",
    );
    expect(duplicate.status).toBe(200);
    expect(
      signupResponse.parse(await duplicate.json()).user.emailVerified,
    ).toBe(false);
    expect(harness.email.messages).toHaveLength(1);
    expect(harness.email.messages[0]?.subject).toContain("이미 가입된");
    expect((await login(harness.auth)).status).toBe(200);
    expect(
      (await login(harness.auth, undefined, "different-password")).status,
    ).toBe(401);
  });

  it.each([
    { name: "empty name", body: { name: "  " } },
    { name: "long name", body: { name: "가".repeat(51) } },
    { name: "short password", body: { password: "1234567" } },
    { name: "long password", body: { password: "a".repeat(129) } },
    { name: "image", body: { image: "https://example.com/avatar.png" } },
    { name: "empty image", body: { image: "" } },
  ])(
    "rejects $name equally for new and existing emails before duplicate lookup",
    async ({ body }) => {
      await signup(harness.auth);
      const request = { name: "회원", password: testPassword, ...body };
      const existing = await authRequest(harness.auth, "/sign-up/email", {
        ...request,
        email: "member@example.com",
      });
      const fresh = await authRequest(harness.auth, "/sign-up/email", {
        ...request,
        email: "new@example.com",
      });
      expect(existing.status).toBe(400);
      expect(fresh.status).toBe(existing.status);
      expect(await fresh.json()).toEqual(await existing.json());
      expect(await harness.db.select().from(users)).toHaveLength(1);
    },
  );

  it("forces the verification destination for signup, sign-in and resend", async () => {
    await authRequest(harness.auth, "/sign-up/email", {
      email: "member@example.com",
      name: "회원",
      password: testPassword,
      callbackURL: "/admin",
    });
    expect(emailLink(harness).searchParams.get("callbackURL")).toBe(
      `${authBaseUrl}/login?verified=1`,
    );
    await login(harness.auth);
    expect(emailLink(harness).searchParams.get("callbackURL")).toBe(
      `${authBaseUrl}/login?verified=1`,
    );
    await authRequest(harness.auth, "/send-verification-email", {
      email: "member@example.com",
      callbackURL: "/admin",
    });
    expect(emailLink(harness).searchParams.get("callbackURL")).toBe(
      `${authBaseUrl}/login?verified=1`,
    );
  });

  it("prevents a preemptive password signup from surviving the mailbox owner's duplicate signup/reset", async () => {
    await signup(harness.auth, "victim@example.com", "attacker-password");
    await signup(harness.auth, "VICTIM@example.com", "victim-password");
    const token = emailLink(harness).pathname.split("/").at(-1);
    expect(
      (
        await authRequest(harness.auth, "/reset-password", {
          token,
          newPassword: "victim-password",
        })
      ).status,
    ).toBe(200);
    expect(
      (await login(harness.auth, "victim@example.com", "attacker-password"))
        .status,
    ).toBe(401);
    expect(
      (await login(harness.auth, "victim@example.com", "victim-password"))
        .status,
    ).toBe(200);
    expect((await harness.db.select().from(users))[0]?.emailVerified).toBe(
      true,
    );
  });

  it("reset revokes every existing session, verifies the mailbox, and consumes a token exactly once", async () => {
    await signup(harness.auth);
    await verifyLastEmail(harness);
    const firstCookie = responseCookie(await login(harness.auth));
    const secondCookie = responseCookie(await login(harness.auth));
    const requested = await authRequest(
      harness.auth,
      "/request-password-reset",
      { email: "member@example.com", redirectTo: "/reset-password" },
    );
    expect(requested.status).toBe(200);
    const url = emailLink(harness);
    const redirect = await harness.auth.handler(new Request(url));
    const token = new URL(
      redirect.headers.get("location")!,
      authBaseUrl,
    ).searchParams.get("token");
    expect(token).toBeTruthy();
    expect(
      (
        await authRequest(harness.auth, "/reset-password", {
          token,
          newPassword: "new-password-123",
        })
      ).status,
    ).toBe(200);
    for (const cookie of [firstCookie, secondCookie])
      expect(
        await harness.auth.api.getSession({ headers: new Headers({ cookie }) }),
      ).toBeNull();
    expect((await login(harness.auth)).status).toBe(401);
    expect(
      (await login(harness.auth, undefined, "new-password-123")).status,
    ).toBe(200);
    expect(
      (
        await authRequest(harness.auth, "/reset-password", {
          token,
          newPassword: "another-password",
        })
      ).status,
    ).toBe(400);
  });

  it("uses the same reset response for known and unknown email addresses", async () => {
    await signup(harness.auth);
    harness.email.messages.length = 0;
    const found = await authRequest(harness.auth, "/request-password-reset", {
      email: "member@example.com",
      redirectTo: "/reset-password",
    });
    const missing = await authRequest(harness.auth, "/request-password-reset", {
      email: "nobody@example.com",
      redirectTo: "/reset-password",
    });
    expect(missing.status).toBe(found.status);
    expect(await missing.json()).toEqual(await found.json());
    expect(harness.email.messages).toHaveLength(1);
  });

  it("returns the installed invalid and expired verification codes without creating a session", async () => {
    await signup(harness.auth);
    for (const [token, code] of [
      ["invalid-token", "INVALID_TOKEN"],
      [
        await createEmailVerificationToken(
          authTestSecret,
          "member@example.com",
          undefined,
          -1,
        ),
        "TOKEN_EXPIRED",
      ],
    ]) {
      const url = new URL("/api/auth/verify-email", authBaseUrl);
      url.searchParams.set("token", token!);
      url.searchParams.set("callbackURL", `${authBaseUrl}/login?verified=1`);
      const response = await harness.auth.handler(new Request(url));
      expect(
        new URL(response.headers.get("location")!).searchParams.get("error"),
      ).toBe(code);
      expect(responseCookie(response)).not.toContain("session_token");
    }
    expect((await harness.db.select().from(users))[0]?.emailVerified).toBe(
      false,
    );
  });

  it("rejects expired reset tokens without changing the password or verifying the user", async () => {
    await signup(harness.auth);
    await authRequest(harness.auth, "/request-password-reset", {
      email: "member@example.com",
      redirectTo: "/reset-password",
    });
    const token = emailLink(harness).pathname.split("/").at(-1);
    const previousPassword = (await harness.db.select().from(authAccounts))[0]
      ?.password;
    await harness.db.update(authVerifications).set({ expiresAt: new Date(0) });
    const response = await authRequest(harness.auth, "/reset-password", {
      token,
      newPassword: "new-password-123",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_TOKEN" });
    expect((await harness.db.select().from(authAccounts))[0]?.password).toBe(
      previousPassword,
    );
    expect((await harness.db.select().from(users))[0]?.emailVerified).toBe(
      false,
    );
  });

  it.each(["google", "github"] as const)(
    "blocks %s linking to an unverified password account",
    async (provider) => {
      await signup(harness.auth, harness.identity.email);
      const response = await socialLogin(harness.auth, provider);
      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ code: "OAUTH_LINK_ERROR" });
      expect(
        (await harness.db.select().from(authAccounts)).map(
          (account) => account.providerId,
        ),
      ).toEqual(["credential"]);
      expect(await harness.db.select().from(authSessions)).toHaveLength(0);
    },
  );

  it.each(["google", "github"] as const)(
    "rejects unverified %s provider data before creating user/account/session",
    async (provider) => {
      harness.identity.emailVerified = false;
      const response = await socialLogin(harness.auth, provider);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: "provider_email_not_verified",
      });
      expect(await harness.db.select().from(users)).toHaveLength(0);
      expect(await harness.db.select().from(authAccounts)).toHaveLength(0);
      expect(await harness.db.select().from(authSessions)).toHaveLength(0);
    },
  );

  it.each(["google", "github"] as const)(
    "checks fresh %s verification even for an already linked user",
    async (provider) => {
      expect((await socialLogin(harness.auth, provider)).status).toBe(200);
      await harness.db.delete(authSessions);
      harness.identity.emailVerified = false;
      const response = await socialLogin(harness.auth, provider);
      expect(response.status).toBe(403);
      expect(await harness.db.select().from(authSessions)).toHaveLength(0);
    },
  );

  it.each(["google", "github"] as const)(
    "links %s to a verified account, removes old password/sessions and notifies only once",
    async (provider) => {
      await signup(harness.auth, harness.identity.email);
      await verifyLastEmail(harness);
      const oldCookie = responseCookie(
        await login(harness.auth, harness.identity.email),
      );
      const oldUserId = (await harness.db.select().from(users))[0]?.id;
      harness.email.messages.length = 0;
      const response = await socialLogin(harness.auth, provider);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ user: { id: oldUserId } });
      expect(await harness.db.select().from(users)).toHaveLength(1);
      expect(
        (await harness.db.select().from(authAccounts)).map(
          (account) => account.providerId,
        ),
      ).toEqual([provider]);
      expect((await login(harness.auth, harness.identity.email)).status).toBe(
        401,
      );
      expect(
        await harness.auth.api.getSession({
          headers: new Headers({ cookie: oldCookie }),
        }),
      ).toBeNull();
      expect(harness.email.messages).toHaveLength(1);
      expect(harness.email.messages[0]?.subject).toContain("소셜 로그인");
      expect((await socialLogin(harness.auth, provider)).status).toBe(200);
      expect(harness.email.messages).toHaveLength(1);
      expect(
        await harness.auth.api.getSession({
          headers: new Headers({ cookie: responseCookie(response) }),
        }),
      ).not.toBeNull();
    },
  );

  it("normalizes social email/name, maps image to avatarUrl, and does not send linking mail for a new social user", async () => {
    harness.identity.email = "SOCIAL@EXAMPLE.COM";
    harness.identity.name = "   ";
    expect((await socialLogin(harness.auth, "google")).status).toBe(200);
    expect((await harness.db.select().from(users))[0]).toMatchObject({
      name: "social",
      email: "social@example.com",
      avatarUrl: harness.identity.image,
    });
    expect(harness.email.messages).toHaveLength(0);
    harness.identity.email = "long@example.com";
    harness.identity.id = "another-social-user";
    harness.identity.name = "가".repeat(51);
    expect((await socialLogin(harness.auth, "google")).status).toBe(200);
    expect(
      (
        await harness.db
          .select()
          .from(users)
          .where(eq(users.email, "long@example.com"))
      )[0]?.name,
    ).toHaveLength(50);
  });

  it("rejects invalid ID tokens and leaves the database unchanged", async () => {
    const response = await authRequest(harness.auth, "/sign-in/social", {
      provider: "google",
      idToken: { token: "invalid-token" },
    });
    expect(response.status).toBe(401);
    expect(await harness.db.select().from(users)).toHaveLength(0);
  });

  it("can restore password login after social linking through mailbox reset", async () => {
    await socialLogin(harness.auth, "google");
    await authRequest(harness.auth, "/request-password-reset", {
      email: harness.identity.email,
      redirectTo: "/reset-password",
    });
    const token = emailLink(harness).pathname.split("/").at(-1);
    expect(
      (
        await authRequest(harness.auth, "/reset-password", {
          token,
          newPassword: testPassword,
        })
      ).status,
    ).toBe(200);
    expect((await login(harness.auth, harness.identity.email)).status).toBe(
      200,
    );
    expect(
      (await harness.db.select().from(authAccounts))
        .map((account) => account.providerId)
        .sort(),
    ).toEqual(["credential", "google"]);
  });

  it("rejects a cross-origin POST without creating an account", async () => {
    const response = await harness.auth.handler(
      new Request(`${authBaseUrl}/api/auth/sign-up/email`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify({
          email: "member@example.com",
          name: "회원",
          password: testPassword,
        }),
      }),
    );
    expect(response.status).toBe(403);
    expect(await harness.db.select().from(users)).toHaveLength(0);
  });

  it.each(disabledAuthPaths)(
    "disables unused public endpoint %s for both HTTP methods",
    async (path) => {
      expect((await authRequest(harness.auth, path)).status).toBe(404);
      expect((await authRequest(harness.auth, path, {})).status).toBe(404);
    },
  );

  it("catches email delivery failures and never logs the raw failure or token", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const failedEmailAuth = createAuth({
        db: harness.db,
        email: {
          async send() {
            throw new Error("secret-token-and-password-must-not-leak");
          },
        },
        secret: authTestSecret,
        baseUrl: authBaseUrl,
        rateLimit: { enabled: false },
      });
      expect((await signup(failedEmailAuth)).status).toBe(200);
      expect(
        (
          await authRequest(failedEmailAuth, "/send-verification-email", {
            email: "member@example.com",
          })
        ).status,
      ).toBe(200);
      expect((await signup(failedEmailAuth)).status).toBe(200);
      expect(logged).toHaveBeenCalled();
      expect(logged.mock.calls.flat()).not.toContain(
        "secret-token-and-password-must-not-leak",
      );
      expect(
        logged.mock.calls.every(
          (call) =>
            call.length === 1 &&
            typeof call[0] === "string" &&
            call[0].startsWith("[auth]"),
        ),
      ).toBe(true);
    } finally {
      logged.mockRestore();
    }
  });

  it("sends signup email only after the adapter transaction has committed", async () => {
    let transactionActive = false;
    const observed: boolean[] = [];
    const db = new Proxy(harness.db, {
      get(target, property, receiver) {
        if (property !== "transaction")
          return Reflect.get(target, property, receiver);
        return async <T>(
          callback: Parameters<typeof target.transaction<T>>[0],
        ) => {
          transactionActive = true;
          try {
            return await target.transaction(callback);
          } finally {
            transactionActive = false;
          }
        };
      },
    });
    const auth = createAuth({
      db,
      email: {
        async send() {
          observed.push(transactionActive);
          expect(await harness.db.select().from(users)).toHaveLength(1);
        },
      },
      secret: authTestSecret,
      baseUrl: authBaseUrl,
      rateLimit: { enabled: false },
    });
    expect((await signup(auth)).status).toBe(200);
    expect(observed).toEqual([false]);
  });

  it("does not send an email when signup rolls back and hides sensitive errors from the logger", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const send = vi.fn(async () => {});
    try {
      const db = new Proxy(harness.db, {
        get(target, property, receiver) {
          if (property !== "transaction")
            return Reflect.get(target, property, receiver);
          return async <T>(
            callback: Parameters<typeof target.transaction<T>>[0],
          ) =>
            target.transaction(async (transaction) => {
              await callback(transaction);
              throw new Error("sensitive-SQL-password-token");
            });
        },
      });
      const auth = createAuth({
        db,
        email: { send },
        secret: authTestSecret,
        baseUrl: authBaseUrl,
        rateLimit: { enabled: false },
      });
      expect((await signup(auth)).status).toBe(500);
      expect(await harness.db.select().from(users)).toHaveLength(0);
      expect(send).not.toHaveBeenCalled();
      expect(logged).toHaveBeenCalled();
      expect(JSON.stringify(logged.mock.calls)).not.toContain(
        "sensitive-SQL-password-token",
      );
    } finally {
      logged.mockRestore();
    }
  });
});
