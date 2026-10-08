import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AVATAR_COLORS } from "@/lib/avatar";
import { authAccounts, users } from "@/lib/db/schema";
import { loadSeedData } from "@/lib/seed/data";
import { runSeed } from "@/lib/seed/run-seed";
import {
  authRequest,
  createAuthTestHarness,
  login,
  responseCookie,
  testPassword,
  type AuthTestHarness,
} from "./auth-helper";

const now = new Date("2026-10-09T03:00:00Z");
const data = loadSeedData();
const fields = {
  id: users.id,
  name: users.name,
  email: users.email,
  avatarColor: users.avatarColor,
  avatarPhoto: users.avatarPhoto,
  avatarUrl: users.avatarUrl,
  chatToasts: users.chatToasts,
  tabBadge: users.tabBadge,
  reminderMinutes: users.reminderMinutes,
  defaultBranchId: users.defaultBranchId,
};

describe("seed and public authentication preserve custom settings", () => {
  let harness: AuthTestHarness;
  beforeAll(async () => {
    harness = await createAuthTestHarness();
    await runSeed({
      db: harness.db,
      auth: harness.auth,
      now,
      resetPasswords: false,
    });
  });
  afterAll(async () => {
    await harness.client.close();
  });

  it("starts all 21 seed accounts with database defaults for the new preferences", async () => {
    const rows = await harness.db.select(fields).from(users);
    expect(rows).toHaveLength(21);
    expect(rows.map(({ email }) => email).sort()).toEqual(
      data.users.map(({ email }) => email).sort(),
    );
    for (const row of rows)
      expect(row).toMatchObject({
        avatarColor: null,
        avatarPhoto: false,
        chatToasts: true,
        tabBadge: true,
        reminderMinutes: [30, 10, 5, 0],
      });
  });

  it("preserves explicit avatar and preference choices for every existing account on a normal full rerun", async () => {
    const originals = await harness.db
      .select(fields)
      .from(users)
      .orderBy(users.id);
    for (const [index, original] of originals.entries()) {
      await harness.db
        .update(users)
        .set({
          name: `사용자가 고른 이름 ${index}`,
          avatarColor:
            index === 0 ? null : AVATAR_COLORS[index % AVATAR_COLORS.length],
          avatarPhoto: index % 2 === 0,
          avatarUrl: `https://avatars.githubusercontent.com/fixture-${index}`,
          chatToasts: index % 2 !== 0,
          tabBadge: index % 3 !== 0,
          reminderMinutes:
            index % 3 === 0 ? [] : index % 3 === 1 ? [10, 0] : [30, 5],
          defaultBranchId: data.branches[index % data.branches.length]!.id,
        })
        .where(eq(users.id, original.id));
    }
    const [unseeded] = await harness.db
      .insert(users)
      .values({
        name: "시드 밖 회원",
        email: "nonseed-settings@example.test",
        emailVerified: true,
        avatarColor: "teal",
        avatarPhoto: true,
        avatarUrl: "https://lh3.googleusercontent.com/nonseed",
        chatToasts: false,
        tabBadge: false,
        reminderMinutes: [],
      })
      .returning();
    const before = await harness.db
      .select(fields)
      .from(users)
      .orderBy(users.id);
    const credentials = await harness.db
      .select({
        id: authAccounts.id,
        userId: authAccounts.userId,
        password: authAccounts.password,
      })
      .from(authAccounts)
      .orderBy(authAccounts.id);
    await runSeed({
      db: harness.db,
      auth: harness.auth,
      now: new Date("2026-10-10T03:00:00Z"),
      resetPasswords: false,
    });
    expect(
      await harness.db.select(fields).from(users).orderBy(users.id),
    ).toEqual(before);
    expect(
      await harness.db
        .select({
          id: authAccounts.id,
          userId: authAccounts.userId,
          password: authAccounts.password,
        })
        .from(authAccounts)
        .orderBy(authAccounts.id),
    ).toEqual(credentials);
    expect(
      (
        await harness.db.select().from(users).where(eq(users.id, unseeded!.id))
      )[0],
    ).toEqual(unseeded);
  });

  it("ignores custom preference and avatar columns submitted to the public signup handler", async () => {
    const response = await authRequest(harness.auth, "/sign-up/email", {
      name: "새 회원",
      email: "signup-settings@example.test",
      password: testPassword,
      avatarColor: "pink",
      avatar_color: "pink",
      avatarPhoto: true,
      avatar_photo: true,
      avatarUrl: "https://avatars.githubusercontent.com/injected",
      chatToasts: false,
      chat_toasts: false,
      tabBadge: false,
      tab_badge: false,
      reminderMinutes: [],
      reminder_minutes: [],
    });
    expect(response.status).toBe(200);
    const [created] = await harness.db
      .select(fields)
      .from(users)
      .where(eq(users.email, "signup-settings@example.test"));
    expect(created).toMatchObject({
      name: "새 회원",
      avatarColor: null,
      avatarPhoto: false,
      avatarUrl: null,
      chatToasts: true,
      tabBadge: true,
      reminderMinutes: [30, 10, 5, 0],
    });
    const serialized = JSON.stringify(await response.json());
    expect(serialized).not.toMatch(
      /avatarColor|avatarPhoto|chatToasts|tabBadge|reminderMinutes|injected/,
    );
  });

  it("keeps the public update-user route disabled even for a valid session and preserves all saved settings", async () => {
    const account = data.users[0]!;
    const cookie = responseCookie(
      await login(harness.auth, account.email, account.password),
    );
    expect(cookie).toContain("session_token=");
    const before = await harness.db
      .select(fields)
      .from(users)
      .where(eq(users.email, account.email));
    const response = await authRequest(
      harness.auth,
      "/update-user",
      {
        name: "바꾸면 안 됨",
        avatarColor: "blue",
        avatarPhoto: false,
        chatToasts: true,
        tabBadge: true,
        reminderMinutes: [30, 10, 5, 0],
      },
      cookie,
    );
    expect(response.status).toBe(404);
    expect(
      await harness.db
        .select(fields)
        .from(users)
        .where(eq(users.email, account.email)),
    ).toEqual(before);
  });
});
