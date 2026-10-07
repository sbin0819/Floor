import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  authAccounts,
  authSessions,
  authVerifications,
  users,
} from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("authentication schema constraints", () => {
  let database: TestDatabase;
  let userId: string;
  let otherUserId: string;
  const expiresAt = new Date("2027-01-01T00:00:00Z");

  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(
      sql`TRUNCATE TABLE users, auth_verifications CASCADE`,
    );
    userId = crypto.randomUUID();
    otherUserId = crypto.randomUUID();
    await database.db.insert(users).values([
      { id: userId, name: "첫 사용자", email: "first@example.test" },
      { id: otherUserId, name: "둘째 사용자", email: "second@example.test" },
    ]);
  });

  it("defaults new profiles to unverified and supplies timestamp columns", async () => {
    const [user] = await database.db
      .select()
      .from(users)
      .where(eq(users.id, userId));
    expect(user).toMatchObject({ id: userId, emailVerified: false });
    expect(user?.createdAt).toBeInstanceOf(Date);
    expect(user?.updatedAt).toBeInstanceOf(Date);
    expect(user).not.toHaveProperty("authId");
    const result = await database.client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'auth_id'",
    );
    expect(result.rows[0]?.count).toBe(0);
  });

  it("cascades only the deleted user's sessions and linked accounts", async () => {
    await database.db.insert(authSessions).values([
      { userId, token: "first-session", expiresAt },
      { userId: otherUserId, token: "second-session", expiresAt },
    ]);
    await database.db.insert(authAccounts).values([
      { userId, providerId: "credential", accountId: userId },
      { userId, providerId: "google", accountId: "first-provider-subject" },
      {
        userId: otherUserId,
        providerId: "credential",
        accountId: otherUserId,
      },
    ]);

    await database.db.delete(users).where(eq(users.id, userId));

    expect(await database.db.select().from(authSessions)).toEqual([
      expect.objectContaining({ userId: otherUserId, token: "second-session" }),
    ]);
    expect(await database.db.select().from(authAccounts)).toEqual([
      expect.objectContaining({ userId: otherUserId, accountId: otherUserId }),
    ]);
  });

  it("rejects the same provider identity linked to two users", async () => {
    await database.db.insert(authAccounts).values({
      userId,
      providerId: "google",
      accountId: "shared-provider-subject",
    });
    await expect(
      database.db.insert(authAccounts).values({
        userId: otherUserId,
        providerId: "google",
        accountId: "shared-provider-subject",
      }),
    ).rejects.toMatchObject({
      cause: {
        code: "23505",
        constraint: "auth_accounts_provider_id_account_id_unique",
      },
    });
  });

  it("allows distinct identities and identical provider subjects on different providers", async () => {
    await database.db.insert(authAccounts).values([
      { userId, providerId: "google", accountId: "provider-subject" },
      { userId, providerId: "github", accountId: "provider-subject" },
      { userId: otherUserId, providerId: "google", accountId: "other-subject" },
    ]);
    expect(await database.db.select().from(authAccounts)).toHaveLength(3);
  });

  it("rejects duplicate session tokens", async () => {
    await database.db.insert(authSessions).values({
      userId,
      token: "unique-token",
      expiresAt,
    });
    await expect(
      database.db.insert(authSessions).values({
        userId: otherUserId,
        token: "unique-token",
        expiresAt,
      }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "auth_sessions_token_unique" },
    });
  });

  it("requires an existing user for sessions and accounts", async () => {
    const missingUserId = crypto.randomUUID();
    await expect(
      database.db.insert(authSessions).values({
        userId: missingUserId,
        token: "orphan-token",
        expiresAt,
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    await expect(
      database.db.insert(authAccounts).values({
        userId: missingUserId,
        providerId: "credential",
        accountId: missingUserId,
      }),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
  });

  it("requires a verification expiry and generates UUIDs and timestamps", async () => {
    await expect(
      database.db.execute(
        sql`INSERT INTO auth_verifications (identifier, value) VALUES ('missing-expiry', 'token-value')`,
      ),
    ).rejects.toMatchObject({
      cause: { code: "23502", column: "expires_at" },
    });
    const [verification] = await database.db
      .insert(authVerifications)
      .values({ identifier: "reset-token", value: userId, expiresAt })
      .returning();
    expect(verification?.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(verification?.expiresAt).toEqual(expiresAt);
    expect(verification?.createdAt).toBeInstanceOf(Date);
    expect(verification?.updatedAt).toBeInstanceOf(Date);
  });
});
