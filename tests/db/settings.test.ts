import { and, eq, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createSettingsActions } from "@/features/settings/action-factory";
import { createSettingsQueries } from "@/features/settings/query-factory";
import { ActionError } from "@/lib/actions/result";
import { createAccountSecurity } from "@/lib/auth/account-security";
import { toAvatar } from "@/lib/avatar";
import { authAccounts, authSessions, branches, users } from "@/lib/db/schema";
import { createAuthTestHarness, type AuthTestHarness } from "./auth-helper";
import { createQueryMeter } from "./query-meter";

const id = (n: number) =>
  `d2000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = new Date("2026-10-09T03:00:00.000Z");
const me = { userId: id(1), name: "김하은", email: "haeun@example.test" };
const photo = "https://lh3.googleusercontent.com/example-photo";
describe("profile settings privacy and query budgets", () => {
  let harness: AuthTestHarness;
  beforeAll(async () => {
    harness = await createAuthTestHarness();
  });
  afterAll(async () => {
    await harness.client.close();
  });
  beforeEach(async () => {
    await harness.db.execute(sql`truncate users, branches cascade`);
    await harness.db.insert(branches).values([
      { id: id(10), name: "가상 첫 지점" },
      { id: id(11), name: "가상 두 번째 지점" },
    ]);
    await harness.db.insert(users).values([
      {
        id: me.userId,
        name: me.name,
        email: me.email,
        emailVerified: true,
        username: "haeun.kim",
        avatarUrl: photo,
        defaultBranchId: id(10),
      },
      {
        id: id(2),
        name: "다른 회원",
        email: "other-private@example.test",
        emailVerified: true,
        username: "other.user",
        avatarColor: "pink",
        chatToasts: false,
        reminderMinutes: [10],
      },
    ]);
    await harness.db.insert(authAccounts).values({
      userId: me.userId,
      providerId: "credential",
      accountId: me.userId,
      password: "private-password-hash",
      accessToken: "private-access-token",
    });
    await harness.db.insert(authSessions).values([
      {
        id: id(20),
        userId: me.userId,
        token: "private-current-token",
        createdAt: new Date(now.getTime() - 2 * 86400000),
        updatedAt: new Date(now.getTime() - 86400000),
        expiresAt: new Date(now.getTime() + 86400000),
        userAgent: "private-ua Chrome/130 Windows",
        ipAddress: "192.0.2.123",
      },
      {
        id: id(21),
        userId: me.userId,
        token: "private-other-token",
        createdAt: now,
        updatedAt: now,
        expiresAt: new Date(now.getTime() + 86400000),
      },
    ]);
  });
  function security() {
    return createAccountSecurity({
      auth: harness.auth,
      currentSessionId: async () => id(20),
      now: () => now,
    });
  }
  function actions() {
    return createSettingsActions({
      database: harness.db,
      getSession: async () => me,
      now: () => now,
      security: security(),
      logError: vi.fn(),
    });
  }
  function queries() {
    return createSettingsQueries({
      database: harness.db,
      requireSession: async () => me,
      now: () => now,
      security: security(),
    });
  }
  async function stored(userId = me.userId) {
    return (
      await harness.db.select().from(users).where(eq(users.id, userId))
    )[0]!;
  }

  it("normalizes the name and updates only the authenticated user's profile", async () => {
    const before = await stored(id(2));
    expect(await actions().updateName({ name: "  김\n\t 하은  " })).toEqual({
      ok: true,
      data: { name: "김 하은" },
    });
    expect(await stored()).toMatchObject({
      name: "김 하은",
      updatedAt: now,
      email: me.email,
      username: "haeun.kim",
    });
    expect(await stored(id(2))).toEqual(before);
    expect(
      await actions().updateName({ name: "hijack", userId: id(2) }),
    ).toMatchObject({ code: "INVALID_INPUT" });
    expect((await stored(id(2))).name).toBe(before.name);
  });

  it("accepts exact name boundaries and rejects normalized empty or oversized values", async () => {
    expect(await actions().updateName({ name: "가" })).toMatchObject({
      ok: true,
    });
    expect(await actions().updateName({ name: "나".repeat(50) })).toMatchObject(
      { ok: true },
    );
    for (const name of [" \n\t ", "가".repeat(51)])
      expect(await actions().updateName({ name })).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
    expect((await stored()).name).toBe("나".repeat(50));
  });

  it("saves a chosen color without turning on a photo or changing another person", async () => {
    const other = await stored(id(2));
    expect(await actions().updateAvatar({ color: "green" })).toEqual({
      ok: true,
      data: { avatar: { color: "green", photoUrl: null }, photo: false },
    });
    expect(await stored()).toMatchObject({
      avatarColor: "green",
      avatarPhoto: false,
      avatarUrl: photo,
      updatedAt: now,
    });
    expect(await stored(id(2))).toEqual(other);
  });

  it("requires both an allowed source and a social login provider, with atomic partial-input rejection", async () => {
    expect(
      await actions().updateAvatar({ color: "purple", photo: true }),
    ).toEqual({ ok: false, code: "INVALID_INPUT" });
    expect(await stored()).toMatchObject({
      avatarColor: null,
      avatarPhoto: false,
    });
    await harness.db.insert(authAccounts).values({
      userId: me.userId,
      providerId: "google",
      accountId: "google-test-id",
    });
    expect(await actions().updateAvatar({ photo: true })).toEqual({
      ok: true,
      data: {
        avatar: { color: toAvatar(await stored()).color, photoUrl: photo },
        photo: true,
      },
    });
    await harness.db
      .update(users)
      .set({ avatarUrl: "https://lh3.googleusercontent.com.evil.test/private" })
      .where(eq(users.id, me.userId));
    expect(await actions().updateAvatar({ photo: true })).toEqual({
      ok: false,
      code: "INVALID_INPUT",
    });
    expect(await actions().updateAvatar({ photo: false })).toMatchObject({
      ok: true,
      data: { avatar: { photoUrl: null }, photo: false },
    });
  });

  it("lets a former social account turn off a photo without provider access", async () => {
    await harness.db
      .update(users)
      .set({ avatarPhoto: true })
      .where(eq(users.id, me.userId));
    const accountSecurity = security();
    const providers = vi
      .spyOn(accountSecurity, "listMyProviders")
      .mockRejectedValue(new Error("must not query providers"));
    const custom = createSettingsActions({
      database: harness.db,
      getSession: async () => me,
      now: () => now,
      security: accountSecurity,
    });
    expect(await custom.updateAvatar({ photo: false })).toMatchObject({
      ok: true,
    });
    expect(providers).not.toHaveBeenCalled();
  });

  it("preserves explicit false, normalizes reminders, and leaves the default branch and other user unchanged", async () => {
    const other = await stored(id(2));
    expect(
      await actions().updatePreferences({
        chatToasts: false,
        reminderMinutes: [0, 30, 10, 30, 5, 0],
      }),
    ).toEqual({
      ok: true,
      data: {
        chatToasts: false,
        tabBadge: true,
        reminderMinutes: [30, 10, 5, 0],
      },
    });
    expect(
      await actions().updatePreferences({
        tabBadge: false,
        reminderMinutes: [],
      }),
    ).toEqual({
      ok: true,
      data: { chatToasts: false, tabBadge: false, reminderMinutes: [] },
    });
    expect(await stored()).toMatchObject({
      defaultBranchId: id(10),
      updatedAt: now,
    });
    expect(await stored(id(2))).toEqual(other);
  });

  it("does not write any setting when one submitted preference is invalid", async () => {
    const before = await stored();
    expect(
      await actions().updatePreferences({
        chatToasts: false,
        reminderMinutes: [30, 15],
      }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await stored()).toEqual(before);
    expect(
      await actions().updatePreferences({ chatToasts: false, userId: id(2) }),
    ).toMatchObject({ code: "INVALID_INPUT" });
    expect(await stored()).toEqual(before);
  });

  it("returns a current self preview and preserves the username contract", async () => {
    const profile = await queries().getProfileSettings();
    expect(profile).toMatchObject({
      userId: me.userId,
      name: me.name,
      photo: false,
      photoProvider: null,
      photoUrl: null,
      usernameSettings: { username: "haeun.kim", now: now.toISOString() },
      preview: {
        userId: me.userId,
        name: me.name,
        isMe: true,
        relation: null,
        canDirectMessage: false,
        avatar: toAvatar(await stored()),
      },
    });
    expect(JSON.stringify(profile)).not.toContain("other-private@example.test");
    expect(JSON.stringify(profile)).not.toMatch(
      /token|ipAddress|userAgent|private-password/,
    );
  });

  it.each(["google", "github"] as const)(
    "offers only an allowed profile photo with a %s provider",
    async (providerId) => {
      await harness.db.insert(authAccounts).values({
        userId: me.userId,
        providerId,
        accountId: `test-${providerId}`,
      });
      expect(await queries().getProfileSettings()).toMatchObject({
        photoProvider: providerId,
        photoUrl: photo,
      });
      await harness.db
        .update(users)
        .set({ avatarUrl: "javascript:private" })
        .where(eq(users.id, me.userId));
      expect(await queries().getProfileSettings()).toMatchObject({
        photoProvider: null,
        photoUrl: null,
      });
    },
  );

  it("returns only owned sanitized sessions and login providers, including an old current session", async () => {
    const account = await queries().getAccountSettings();
    expect(account.email).toBe(me.email);
    expect(account.emailVerified).toBe(true);
    expect(account.providers).toEqual(["credential"]);
    expect(account.sessions.map(({ id: value }) => value)).toEqual([
      id(20),
      id(21),
    ]);
    expect(account.sessions[0]).toMatchObject({
      current: true,
      browser: "Chrome",
      os: "Windows",
    });
    expect(Object.keys(account).sort()).toEqual([
      "email",
      "emailVerified",
      "providers",
      "sessions",
    ]);
    expect(JSON.stringify(account)).not.toMatch(
      /token|ipAddress|userAgent|private|192\.0\.2|password/,
    );
  });

  it("lists selectable branches and the user's current preference values without member details", async () => {
    const result = await queries().getPreferences();
    expect(result).toMatchObject({
      defaultBranchId: id(10),
      chatToasts: true,
      tabBadge: true,
      reminderMinutes: [30, 10, 5, 0],
    });
    expect(result.branches.map((branch) => branch.id).sort()).toEqual([
      id(10),
      id(11),
    ]);
    for (const branch of result.branches)
      expect(Object.keys(branch).sort()).toEqual(["id", "name"]);
  });

  it.each([
    "getProfileSettings",
    "getAccountSettings",
    "getPreferences",
  ] as const)(
    "checks its own session before any DB read in %s",
    async (name) => {
      const unauthorized = createSettingsQueries({
        database: harness.db,
        requireSession: async () => {
          throw new ActionError("UNAUTHENTICATED");
        },
        security: security(),
      });
      const meter = createQueryMeter(harness.client);
      try {
        meter.start();
        await expect(unauthorized[name]()).rejects.toMatchObject({
          code: "UNAUTHENTICATED",
        });
        expect(meter.stop()).toEqual({
          stages: 0,
          statements: 0,
          perStage: [],
        });
      } finally {
        meter.restore();
      }
    },
  );

  it.each([
    ["getProfileSettings", [4]],
    ["getAccountSettings", [3, 1]],
    ["getPreferences", [2]],
  ] as const)(
    "keeps %s within two stages and six statements per stage using real auth adapters",
    async (name, expected) => {
      // Better Auth configuration and all fixture inserts are outside the measured read.
      await harness.auth.$context;
      const meter = createQueryMeter(harness.client);
      try {
        meter.start();
        await queries()[name]();
        const measurement = meter.stop();
        expect(measurement.perStage).toEqual(expected);
        expect(measurement.stages).toBeLessThanOrEqual(2);
        expect(Math.max(...measurement.perStage)).toBeLessThanOrEqual(6);
      } finally {
        meter.restore();
      }
    },
  );

  it("does not expose account credentials in the auth-backed provider query", async () => {
    await harness.db
      .update(authAccounts)
      .set({
        accessToken: "sensitive-access",
        refreshToken: "sensitive-refresh",
        idToken: "sensitive-id",
      })
      .where(
        and(
          eq(authAccounts.userId, me.userId),
          eq(authAccounts.providerId, "credential"),
        ),
      );
    expect((await queries().getAccountSettings()).providers).toEqual([
      "credential",
    ]);
    expect(JSON.stringify(await queries().getAccountSettings())).not.toContain(
      "sensitive",
    );
  });
});
