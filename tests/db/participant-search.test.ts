import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createParticipantSearch } from "@/features/bookings/participant-search-factory";
import { ActionError } from "@/lib/actions/result";
import { avatarColorFor } from "@/lib/avatar";
import { users, teamMembers, teams } from "@/lib/db/schema";
import {
  createMemoryRateLimiter,
  RateLimitError,
} from "@/lib/rate-limit/memory";
import { seedBookingActors, type BookingActors } from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("participant search privacy and limits", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    fixture = await seedBookingActors(database);
  });
  const search = (session = fixture.member) =>
    createParticipantSearch({
      database: database.db,
      requireSession: async () => session,
      limiter: createMemoryRateLimiter(() => 0),
    });
  it("finds shared-team partial names/emails but not external partial matches", async () => {
    const read = search();
    expect(await read("관리자")).toEqual([
      {
        userId: fixture.admin.userId,
        name: fixture.admin.name,
        avatar: {
          color: avatarColorFor(fixture.admin.userId, null),
          photoUrl: null,
        },
        sharedTeamNames: ["그로스팀"],
        maskedEmail: "ad•••@example.test",
      },
    ]);
    expect(await read("adm")).toHaveLength(1);
    expect(await read("다른 예약자")).toEqual([]);
    expect(await read("stranger@")).toEqual([]);
    expect(await read(fixture.stranger.email.toUpperCase())).toEqual([
      {
        userId: fixture.stranger.userId,
        name: fixture.stranger.name,
        avatar: {
          color: avatarColorFor(fixture.stranger.userId, null),
          photoUrl: null,
        },
        sharedTeamNames: [],
        maskedEmail: "st•••@example.test",
      },
    ]);
    expect(await search(fixture.person)("관리자")).toEqual([]);
  });
  it("adds only the safe avatar to participant results without exposing photo preferences or raw URLs", async () => {
    await database.db
      .update(users)
      .set({
        avatarColor: "orange",
        avatarPhoto: true,
        avatarUrl: "https://lh3.googleusercontent.com/photo",
      })
      .where(eq(users.id, fixture.admin.userId));
    const first = (await search()("관리자"))[0]!;
    expect(first.avatar).toEqual({
      color: "orange",
      photoUrl: "https://lh3.googleusercontent.com/photo",
    });
    expect(Object.keys(first).sort()).toEqual([
      "avatar",
      "maskedEmail",
      "name",
      "sharedTeamNames",
      "userId",
    ]);
    await database.db
      .update(users)
      .set({ avatarUrl: "https://unsafe.example.test/photo" })
      .where(eq(users.id, fixture.admin.userId));
    expect((await search()("관리자"))[0]?.avatar).toEqual({
      color: "orange",
      photoUrl: null,
    });
  });
  it("never returns the caller or unverified accounts even for exact emails", async () => {
    const read = search();
    expect(
      (await read(fixture.member.email)).some(
        ({ userId }) => userId === fixture.member.userId,
      ),
    ).toBe(false);
    await database.db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, fixture.admin.userId));
    expect(await read(fixture.admin.email)).toEqual([]);
    expect(await read("관리자")).toEqual([]);
  });
  it("escapes wildcard characters and validates before SQL", async () => {
    const read = search();
    for (const value of ["%%", "__", "\\\\", "%_", "김", "a".repeat(255)])
      expect(await read(value)).toEqual([]);
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      expect(await read("a")).toEqual([]);
      expect(meter.stop().statements).toBe(0);
    } finally {
      meter.restore();
    }
  });
  it("limits all attempts to 30 and email attempts independently to 10", async () => {
    const all = search();
    for (let i = 0; i < 30; i++) await all("");
    await expect(all("")).rejects.toMatchObject({ retryAfter: 60 });
    const email = search();
    for (let i = 0; i < 10; i++) await email("@");
    await expect(email("@")).rejects.toBeInstanceOf(RateLimitError);
    expect(await email("ab")).toEqual([]);
  });
  it("matches literal wildcards only and places a shared-team match ahead of the exact external email", async () => {
    await database.db
      .update(users)
      .set({ name: "문자 %_\\ 예시" })
      .where(eq(users.id, fixture.admin.userId));
    expect((await search()("%_\\")).map(({ userId }) => userId)).toEqual([
      fixture.admin.userId,
    ]);
    await database.db
      .update(users)
      .set({ name: `같은 팀 ${fixture.stranger.email}` })
      .where(eq(users.id, fixture.admin.userId));
    expect(
      (await search()(fixture.stranger.email)).map(({ userId }) => userId),
    ).toEqual([fixture.admin.userId, fixture.stranger.userId]);
  });
  it("checks session before consuming limits or touching SQL", async () => {
    const consume = vi.fn();
    const read = createParticipantSearch({
      database: database.db,
      limiter: { consume },
      requireSession: async () => {
        throw new ActionError("UNAUTHENTICATED");
      },
    });
    await expect(read("ab")).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(consume).not.toHaveBeenCalled();
  });
  it("aggregates shared teams once, sorts shared-team first, masks emails, and caps at eight in one statement", async () => {
    const [extraTeam] = await database.db
      .insert(teams)
      .values({ name: "추가팀", createdBy: fixture.member.userId })
      .returning();
    if (!extraTeam) throw new Error("Missing search fixture team.");
    await database.db.insert(teamMembers).values([
      { teamId: extraTeam.id, userId: fixture.member.userId, role: "member" },
      { teamId: extraTeam.id, userId: fixture.admin.userId, role: "member" },
    ]);
    const added = await database.db
      .insert(users)
      .values(
        Array.from({ length: 10 }, (_, i) => ({
          name: `검색 ${String(i).padStart(2, "0")}`,
          email: `find-${i}@example.test`,
          emailVerified: true,
        })),
      )
      .returning();
    await database.db.insert(teamMembers).values(
      added.map(({ id }) => ({
        teamId: fixture.teamId,
        userId: id,
        role: "member" as const,
      })),
    );
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const result = await search()("example.test");
      expect(meter.stop().perStage).toEqual([1]);
      expect(result).toHaveLength(8);
      expect(
        result.every(({ sharedTeamNames }) => sharedTeamNames.length > 0),
      ).toBe(true);
      expect(result.map(({ name }) => name)).toEqual(
        added.slice(0, 8).map(({ name }) => name),
      );
      expect(JSON.stringify(result)).not.toMatch(/[A-Za-z0-9]{3,}@/u);
      expect(
        result.every(
          (row) =>
            Object.keys(row).sort().join() ===
            ["userId", "name", "avatar", "sharedTeamNames", "maskedEmail"]
              .sort()
              .join(),
        ),
      ).toBe(true);
      expect((await search()(fixture.admin.email))[0]!.sharedTeamNames).toEqual(
        ["그로스팀", "추가팀"],
      );
    } finally {
      meter.restore();
    }
  });
});
