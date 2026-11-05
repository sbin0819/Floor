import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createAuth, createProvisioningAuth } from "@/lib/auth/auth";
import { authVerifications, notifications, users } from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import {
  createAuthTestHarness,
  signup,
  socialLogin,
  type AuthTestHarness,
} from "./auth-helper";

describe("welcome notification for first-time members", () => {
  let harness: AuthTestHarness;
  beforeAll(async () => {
    harness = await createAuthTestHarness();
  });
  afterAll(async () => {
    await harness.client.close();
  });
  beforeEach(async () => {
    await harness.db.delete(authVerifications);
    await harness.db.delete(notifications);
    await harness.db.delete(users);
    harness.email.messages.length = 0;
  });
  const rows = () => harness.db.select().from(notifications);

  it("leaves exactly one actorless welcome row for an email signup, dated at signup", async () => {
    expect((await signup(harness.auth, "new@example.com")).status).toBe(200);
    const [user] = await harness.db
      .select()
      .from(users)
      .where(eq(users.email, "new@example.com"));
    expect(await rows()).toEqual([
      expect.objectContaining({
        userId: user!.id,
        type: "welcome",
        actorId: null,
        bookingId: null,
        data: { name: "회원 이름" },
        scheduledFor: user!.createdAt,
        expiresAt: null,
        readAt: null,
      }),
    ]);
    // 같은 이메일로 다시 가입을 시도해도 환영 알림은 늘지 않는다.
    expect((await signup(harness.auth, "new@example.com")).status).toBe(200);
    expect(await rows()).toHaveLength(1);
  });

  it("welcomes a first social login once and not on later logins", async () => {
    expect((await socialLogin(harness.auth, "google")).status).toBe(200);
    expect((await socialLogin(harness.auth, "google")).status).toBe(200);
    const list = await rows();
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      type: "welcome",
      data: { name: harness.identity.name },
    });
  });

  it("does not welcome accounts prepared by the provisioning helper", async () => {
    const auth = createAuth({
      db: harness.db,
      email: createMemoryEmailSender(),
      secret: "welcome-provisioning-secret-with-32-bytes!",
      baseUrl: "http://localhost:3000",
      rateLimit: { enabled: false },
    });
    const provisioning = await createProvisioningAuth({ db: harness.db, auth });
    await provisioning.createVerifiedUser({
      email: "seeded@example.com",
      name: "시드 계정",
    });
    expect(await rows()).toEqual([]);
  });
});
