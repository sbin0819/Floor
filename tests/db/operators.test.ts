import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createAuth, type AuthInstance } from "@/lib/auth/auth";
import * as authModule from "@/lib/auth/auth";
import { createOperator } from "@/lib/auth/operators";
import * as dal from "@/lib/dal";
import {
  authAccounts,
  authSessions,
  branches,
  branchStaff,
  chatSpaces,
  chatRooms,
  users,
} from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import { createAuthTestHarness, socialLogin } from "./auth-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

const baseUrl = "http://localhost:3000";
const originalPassword = "original-password-123";
const replacementPassword = "replacement-password-456";

describe("operator provisioning", () => {
  let database: TestDatabase;
  let auth: AuthInstance;
  let branchId: string;
  let otherBranchId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
    auth = createAuth({
      db: database.db,
      email: createMemoryEmailSender(),
      secret: "operator-tests-secret-with-at-least-32-bytes",
      baseUrl,
      rateLimit: { enabled: false },
    });
  });
  afterAll(async () => {
    await database?.client.close();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  beforeEach(async () => {
    await database.db.execute(
      sql`TRUNCATE TABLE users, branches, auth_verifications CASCADE`,
    );
    branchId = crypto.randomUUID();
    otherBranchId = crypto.randomUUID();
    await database.db.insert(branches).values([
      { id: branchId, name: "가상 지점" },
      { id: otherBranchId, name: "다른 지점" },
    ]);
  });

  function post(path: string, body: Record<string, unknown>) {
    return auth.handler(
      new Request(`${baseUrl}/api/auth/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify(body),
      }),
    );
  }

  async function existingUser(email: string, verified = true) {
    const response = await post("sign-up/email", {
      name: "기존 사용자",
      email,
      password: originalPassword,
    });
    expect(response.ok).toBe(true);
    const [user] = await database.db
      .select()
      .from(users)
      .where(eq(users.email, email));
    if (!user) throw new Error("Expected a registered fixture user.");
    if (verified)
      await database.db
        .update(users)
        .set({ emailVerified: true })
        .where(eq(users.id, user.id));
    return { ...user, emailVerified: verified };
  }

  async function readSession(cookie: string) {
    const response = await auth.handler(
      new Request(`${baseUrl}/api/auth/get-session`, {
        headers: { cookie },
      }),
    );
    return response.json() as Promise<unknown>;
  }

  it("creates a verified operator that can log in with the specified password", async () => {
    const result = await createOperator(
      {
        email: "ops@example.test",
        name: "운영자",
        branch: "가상 지점",
        password: originalPassword,
      },
      { auth, db: database.db },
    );
    expect(result).toMatchObject({
      branchId,
      createdUser: true,
      passwordChanged: true,
    });
    expect(result).not.toHaveProperty("generatedPassword");
    expect(await dal.getUserById(result.userId, database.db)).toMatchObject({
      emailVerified: true,
    });
    expect(await dal.getOperatorBranches(result.userId, database.db)).toEqual([
      { id: branchId, name: "가상 지점" },
    ]);
    const response = await post("sign-in/email", {
      email: "ops@example.test",
      password: originalPassword,
    });
    expect(response.ok).toBe(true);
    expect(response.headers.get("set-cookie")).toBeTruthy();
  });

  it("keeps the public OAuth verification gate after creating an operator", async () => {
    const harness = await createAuthTestHarness();
    try {
      const publicOptions = harness.auth.options;
      const validateUserInfo = publicOptions.user?.validateUserInfo;
      expect(validateUserInfo).toBeTypeOf("function");

      await createOperator(
        {
          email: "ops@example.test",
          name: "운영자",
          branch: "가상 지점",
          createBranch: true,
          password: originalPassword,
        },
        { auth: harness.auth, db: harness.db },
      );

      const previousUsers = await harness.db.select().from(users);
      const previousAccounts = await harness.db.select().from(authAccounts);
      expect(previousUsers).toHaveLength(1);
      expect(previousAccounts).toHaveLength(1);
      expect(harness.auth.options).toBe(publicOptions);
      expect(harness.auth.options.user?.validateUserInfo).toBe(
        validateUserInfo,
      );

      harness.identity.emailVerified = false;
      for (const provider of ["google", "github"] as const) {
        const response = await socialLogin(harness.auth, provider);
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({
          code: "provider_email_not_verified",
        });
        expect(await harness.db.select().from(users)).toEqual(previousUsers);
        expect(await harness.db.select().from(authAccounts)).toEqual(
          previousAccounts,
        );
        expect(await harness.db.select().from(authSessions)).toHaveLength(0);
      }
    } finally {
      await harness.client.close();
    }
  });

  it("normalizes uppercase email and returns an actual generated password only for new credentials", async () => {
    const result = await createOperator(
      {
        email: "OPS@EXAMPLE.TEST",
        name: "운영자",
        branch: "가상 지점",
      },
      { auth, db: database.db },
    );
    expect(result.generatedPassword).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(await dal.getUserById(result.userId, database.db)).toMatchObject({
      email: "ops@example.test",
    });
    expect(
      (
        await post("sign-in/email", {
          email: "ops@example.test",
          password: result.generatedPassword,
        })
      ).ok,
    ).toBe(true);
  });

  it("adds a branch to a verified existing account without changing its password or name", async () => {
    const user = await existingUser("member@example.test");
    const result = await createOperator(
      {
        email: user.email,
        name: "바꾸지 않을 이름",
        branch: "가상 지점",
        password: replacementPassword,
      },
      { auth, db: database.db },
    );
    expect(result).toMatchObject({
      userId: user.id,
      createdUser: false,
      passwordChanged: false,
    });
    expect(result.generatedPassword).toBeUndefined();
    expect(await dal.getUserById(user.id, database.db)).toMatchObject({
      name: "기존 사용자",
    });
    expect(
      (
        await post("sign-in/email", {
          email: user.email,
          password: originalPassword,
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await post("sign-in/email", {
          email: user.email,
          password: replacementPassword,
        })
      ).ok,
    ).toBe(false);
  });

  it("makes assigning an existing operator to the same branch idempotent", async () => {
    const user = await existingUser("member@example.test");
    const input = { email: user.email, branch: "가상 지점" };
    await createOperator(input, { auth, db: database.db });
    await createOperator(input, { auth, db: database.db });
    expect(await database.db.select().from(branchStaff)).toHaveLength(1);
    await createOperator(
      { ...input, branch: "다른 지점" },
      { auth, db: database.db },
    );
    expect(await dal.getOperatorBranches(user.id, database.db)).toEqual([
      { id: branchId, name: "가상 지점" },
      { id: otherBranchId, name: "다른 지점" },
    ]);
    expect(
      await dal.getOperatorBranches(crypto.randomUUID(), database.db),
    ).toEqual([]);
  });

  it("refuses an unverified existing account without explicit password reset", async () => {
    const user = await existingUser("unverified@example.test", false);
    await expect(
      createOperator(
        { email: user.email, branch: "가상 지점" },
        { auth, db: database.db },
      ),
    ).rejects.toMatchObject({ code: "UNVERIFIED_ACCOUNT" });
    expect(await database.db.select().from(branchStaff)).toHaveLength(0);
    expect(await dal.getUserById(user.id, database.db)).toMatchObject({
      emailVerified: false,
    });
  });

  it("resets the password, verifies an existing account, and removes every old session", async () => {
    const user = await existingUser("reset@example.test");
    const login = await post("sign-in/email", {
      email: user.email,
      password: originalPassword,
    });
    expect(login.ok).toBe(true);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    expect(await readSession(cookie)).not.toBeNull();
    await database.db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, user.id));

    await createOperator(
      {
        email: user.email,
        branch: "가상 지점",
        password: replacementPassword,
        resetPassword: true,
      },
      { auth, db: database.db },
    );

    expect(await readSession(cookie)).toBeNull();
    expect(await database.db.select().from(authSessions)).toHaveLength(0);
    expect(await dal.getUserById(user.id, database.db)).toMatchObject({
      emailVerified: true,
    });
    expect(
      (
        await post("sign-in/email", {
          email: user.email,
          password: originalPassword,
        })
      ).ok,
    ).toBe(false);
    expect(
      (
        await post("sign-in/email", {
          email: user.email,
          password: replacementPassword,
        })
      ).ok,
    ).toBe(true);
  });

  it("adds password credentials to a social-only account on reset and warns about social access", async () => {
    const id = crypto.randomUUID();
    const email = "social@example.test";
    await database.db
      .insert(users)
      .values({ id, email, name: "소셜 사용자", emailVerified: true });
    await database.db.insert(authAccounts).values({
      userId: id,
      providerId: "google",
      accountId: "provider-subject",
    });
    const result = await createOperator(
      { email, branch: "가상 지점", resetPassword: true },
      { auth, db: database.db },
    );
    expect(result.warnings).toEqual([expect.stringContaining("소셜 로그인")]);
    expect(result.generatedPassword).toBeDefined();
    expect(
      (
        await post("sign-in/email", {
          email,
          password: result.generatedPassword,
        })
      ).ok,
    ).toBe(true);
    expect(await database.db.select().from(authAccounts)).toHaveLength(2);
  });

  it("warns about social login without changing an existing account when reset was not requested", async () => {
    const user = await existingUser("social-member@example.test");
    await database.db.insert(authAccounts).values({
      userId: user.id,
      providerId: "github",
      accountId: "github-subject",
    });
    const result = await createOperator(
      { email: user.email, branch: "가상 지점" },
      { auth, db: database.db },
    );
    expect(result.warnings).toContainEqual(
      expect.stringContaining("소셜 로그인"),
    );
    expect(result.generatedPassword).toBeUndefined();
  });

  it("requires a new user's name and accepts an absent name for an existing user", async () => {
    await expect(
      createOperator(
        { email: "new@example.test", branch: "가상 지점" },
        { auth, db: database.db },
      ),
    ).rejects.toMatchObject({ code: "NAME_REQUIRED" });
    const user = await existingUser("existing@example.test");
    await expect(
      createOperator(
        { email: user.email, branch: "가상 지점" },
        { auth, db: database.db },
      ),
    ).resolves.toMatchObject({ userId: user.id });
  });

  it("refuses a missing branch without creating a user", async () => {
    await expect(
      createOperator(
        { email: "new@example.test", name: "운영자", branch: "없는 지점" },
        { auth, db: database.db },
      ),
    ).rejects.toMatchObject({ code: "BRANCH_NOT_FOUND" });
    expect(await database.db.select().from(users)).toHaveLength(0);
  });

  it("refuses an ambiguous branch even with create-branch enabled", async () => {
    await database.db.insert(branches).values({ name: "가상 지점" });
    await expect(
      createOperator(
        {
          email: "new@example.test",
          name: "운영자",
          branch: "가상 지점",
          createBranch: true,
        },
        { auth, db: database.db },
      ),
    ).rejects.toMatchObject({ code: "BRANCH_AMBIGUOUS" });
    expect(await database.db.select().from(users)).toHaveLength(0);
  });

  it("creates a requested missing branch with its default timezone", async () => {
    const result = await createOperator(
      {
        email: "new@example.test",
        name: "운영자",
        branch: "새 지점",
        createBranch: true,
      },
      { auth, db: database.db },
    );
    expect(
      await database.db
        .select()
        .from(branches)
        .where(eq(branches.id, result.branchId)),
    ).toEqual([
      expect.objectContaining({ name: "새 지점", timezone: "Asia/Seoul" }),
    ]);
  });

  it("rejects a seven-character password before any database writes", async () => {
    await expect(
      createOperator(
        {
          email: "new@example.test",
          name: "운영자",
          branch: "새 지점",
          createBranch: true,
          password: "short77",
        },
        { auth, db: database.db },
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await database.db.select().from(users)).toHaveLength(0);
    expect(await database.db.select().from(branches)).toHaveLength(2);
  });

  it("rolls back new user, credential, and branch creation when assigning staff fails", async () => {
    vi.spyOn(dal, "addBranchStaff").mockRejectedValueOnce(
      new Error("private SQL/password details"),
    );
    await expect(
      createOperator(
        {
          email: "new@example.test",
          name: "운영자",
          branch: "새 지점",
          createBranch: true,
        },
        { auth, db: database.db },
      ),
    ).rejects.toMatchObject({ code: "INTERNAL" });
    expect(await database.db.select().from(users)).toHaveLength(0);
    expect(await database.db.select().from(authAccounts)).toHaveLength(0);
    expect(await database.db.select().from(branches)).toHaveLength(2);
    expect(await database.db.select().from(branchStaff)).toHaveLength(0);
    expect(await database.db.select().from(chatSpaces)).toHaveLength(0);
    expect(await database.db.select().from(chatRooms)).toHaveLength(0);
  });

  it("rolls back the new branch and lounge when user creation fails after provisioning the rooms", async () => {
    const original = authModule.createProvisioningAuth;
    vi.spyOn(authModule, "createProvisioningAuth").mockImplementationOnce(
      async (input) => {
        const provisioning = await original(input);
        return {
          ...provisioning,
          createVerifiedUser: async () => {
            expect(await input.db.select().from(chatSpaces)).toHaveLength(1);
            expect(await input.db.select().from(chatRooms)).toHaveLength(2);
            throw new Error("Injected account creation failure");
          },
        };
      },
    );
    await expect(
      createOperator(
        {
          email: "failed@example.test",
          name: "운영자",
          branch: "생성 실패 지점",
          createBranch: true,
        },
        { auth, db: database.db },
      ),
    ).rejects.toMatchObject({ code: "INTERNAL" });
    expect(await database.db.select().from(branches)).toHaveLength(2);
    expect(await database.db.select().from(chatSpaces)).toEqual([]);
    expect(await database.db.select().from(chatRooms)).toEqual([]);
    expect(await database.db.select().from(users)).toEqual([]);
  });

  it("rolls back password, verification, and session revocation when a later write fails", async () => {
    const user = await existingUser("rollback@example.test");
    const login = await post("sign-in/email", {
      email: user.email,
      password: originalPassword,
    });
    expect(login.ok).toBe(true);
    const cookie = login.headers
      .getSetCookie()
      .map((value) => value.split(";")[0])
      .join("; ");
    await database.db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, user.id));
    const before = await database.db.select().from(authAccounts);
    vi.spyOn(dal, "addBranchStaff").mockRejectedValueOnce(
      new Error("late write failed"),
    );

    await expect(
      createOperator(
        {
          email: user.email,
          branch: "가상 지점",
          resetPassword: true,
          password: replacementPassword,
        },
        { auth, db: database.db },
      ),
    ).rejects.toMatchObject({ code: "INTERNAL" });

    expect(await database.db.select().from(authAccounts)).toEqual(before);
    expect(await dal.getUserById(user.id, database.db)).toMatchObject({
      emailVerified: false,
    });
    expect(await database.db.select().from(authSessions)).toHaveLength(1);
    expect(await readSession(cookie)).not.toBeNull();
    expect(await database.db.select().from(branchStaff)).toHaveLength(0);
  });
});
