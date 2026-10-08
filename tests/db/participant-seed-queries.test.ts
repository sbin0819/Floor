import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createBookingQueries } from "@/features/bookings/query-factory";
import { createAuth } from "@/lib/auth/auth";
import { users } from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import { runSeed } from "@/lib/seed/run-seed";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("seeded sprint invitation", () => {
  let database: TestDatabase;
  const now = new Date("2026-10-08T00:00:00Z");
  beforeAll(async () => {
    database = await createTestDatabase();
    const auth = createAuth({
      db: database.db,
      email: createMemoryEmailSender(),
      secret: "participant-seed-query-secret-with-at-least-32-bytes",
      baseUrl: "http://localhost:3000",
      rateLimit: { enabled: false },
    });
    await runSeed({ db: database.db, auth, now, resetPasswords: false });
  });
  afterAll(async () => {
    await database.client.close();
  });
  const query = async (email: string) => {
    const [user] = await database.db
      .select()
      .from(users)
      .where(eq(users.email, email));
    if (!user) throw new Error("Missing seeded account.");
    return createBookingQueries({
      database: database.db,
      requireSession: async () => ({
        userId: user.id,
        email: user.email,
        name: user.name,
      }),
      now: () => now,
    });
  };
  it("shows Kim Haeun the invitation without a private room photo and Minjun the names", async () => {
    const member = await (await query("member@floor.com")).getMyBookings();
    const invited = member.upcoming.find(
      ({ title }) => title === "스프린트 계획",
    );
    expect(invited).toMatchObject({
      relation: "invited",
      invitedByName: "최민준",
      spaceName: "회의실 A",
      photo: null,
    });
    const owner = await (await query("growth.admin@floor.com")).getMyBookings();
    expect(
      owner.upcoming.find(({ title }) => title === "스프린트 계획"),
    ).toMatchObject({
      relation: "owner",
      participantNames: ["김하은", "정유나"],
    });
  });
});
