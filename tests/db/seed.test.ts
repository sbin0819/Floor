import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createAuth,
  createProvisioningAuth,
  type AuthInstance,
} from "@/lib/auth/auth";
import { getMemberships, getSpaceForAccess } from "@/lib/dal";
import {
  accessGrants,
  authAccounts,
  authSessions,
  bookings,
  branches,
  branchStaff,
  chatSpaces,
  floorPlans,
  floors,
  messages,
  spaceBlocks,
  spacePhotos,
  spaces,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import { canAccess, canAccessFloor } from "@/lib/permissions/can-access";
import { loadSeedData } from "@/lib/seed/data";
import { loadSeedBookings2 } from "@/lib/seed/bookings-2";
import { runSeed } from "@/lib/seed/run-seed";
import { getOpenHours } from "@/lib/time/open-hours";
import { localDate, localTime } from "@/lib/time/zoned";
import { createTestDatabase, type TestDatabase } from "./helper";

const now = new Date("2026-10-07T03:00:00Z");
const fixtures = loadSeedData();
const attendeeCounts = new Map(
  loadSeedBookings2(fixtures).attendeeCounts.map(
    ({ bookingId, attendeeCount }) => [bookingId, attendeeCount],
  ),
);
const expectedCounts = {
  users: 6,
  branches: 5,
  floors: 11,
  spaces: 71,
  teams: 2,
  teamMembers: 5,
  branchStaff: 5,
  accessGrants: 2,
  floorPlans: 1,
  bookings: 30,
  spaceBlocks: 5,
  spacePhotos: 65,
  branchCovers: 5,
  chatSpaces: 2,
  chatMessages: 8,
};

describe("transactional development seed", () => {
  let database: TestDatabase;
  let auth: AuthInstance;
  const email = createMemoryEmailSender();
  beforeAll(async () => {
    database = await createTestDatabase();
    auth = createAuth({
      db: database.db,
      email,
      secret: "seed-tests-secret-with-at-least-32-bytes",
      baseUrl: "http://localhost:3000",
      rateLimit: { enabled: false },
    });
  });
  afterAll(async () => {
    await database?.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(
      sql`TRUNCATE users, branches, auth_verifications CASCADE`,
    );
  });
  const seed = (date = now, resetPasswords = false) =>
    runSeed({ db: database.db, auth, now: date, resetPasswords });
  async function counts() {
    const entries = await Promise.all(
      Object.entries({
        users,
        branches,
        floors,
        spaces,
        teams,
        teamMembers,
        branchStaff,
        accessGrants,
        floorPlans,
        bookings,
        spaceBlocks,
        spacePhotos,
        chatSpaces,
        chatMessages: messages,
      }).map(async ([name, table]) => [
        name,
        (await database.db.select().from(table)).length,
      ]),
    );
    return {
      ...Object.fromEntries(entries),
      branchCovers: (await database.db.select().from(branches)).filter(
        ({ coverPhotoPath }) => coverPhotoPath !== null,
      ).length,
    };
  }
  async function user(email: string) {
    const [row] = await database.db
      .select()
      .from(users)
      .where(eq(users.email, email));
    if (!row) throw new Error("Missing test user.");
    return row;
  }
  function login(email: string, password: string) {
    return auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ email, password }),
      }),
    );
  }
  async function account(email: string, verified = true) {
    const provisioning = await createProvisioningAuth({
      db: database.db,
      auth,
    });
    const created = await provisioning.createVerifiedUser({
      email,
      name: "기존 사람",
    });
    await provisioning.setPassword(
      created.id,
      await provisioning.hashPassword("existing-password"),
    );
    if (!verified)
      await database.db
        .update(users)
        .set({ emailVerified: false })
        .where(eq(users.id, created.id));
    return created;
  }

  it("writes the exact fixture counts, verified credentials and published pointer without email", async () => {
    const result = await seed();
    expect(result.counts).toEqual(expectedCounts);
    expect(await counts()).toEqual(expectedCounts);
    expect(result.skippedBookings).toBe(0);
    expect(result.accounts).toEqual(fixtures.users.map(({ email }) => email));
    for (const input of fixtures.users) {
      expect((await user(input.email)).emailVerified).toBe(true);
      expect((await login(input.email, input.password)).status).toBe(200);
    }
    const admin = await user("admin@floor.com");
    expect(
      (await getMemberships(admin.id, database.db)).staffBranchIds.sort(),
    ).toEqual(fixtures.branches.map(({ id }) => id).sort());
    const [floor] = await database.db
      .select()
      .from(floors)
      .where(eq(floors.id, fixtures.floorPlans[0]!.floorId));
    expect(floor!.publishedPlanId).toBe(fixtures.floorPlans[0]!.id);
    expect((await database.db.select().from(floorPlans))[0]!.status).toBe(
      "published",
    );
    const rows = await database.db.select().from(bookings);
    expect(rows.filter(({ status }) => status === "confirmed")).toHaveLength(
      26,
    );
    expect(rows.filter(({ status }) => status === "cancelled")).toHaveLength(4);
    for (const fixture of fixtures.bookings) {
      const actual = rows.find(({ id }) => id === fixture.id)!;
      expect(actual.attendeeCount).toBe(attendeeCounts.get(fixture.id) ?? null);
      if (fixture.status === "cancelled") {
        const actor = fixtures.users.find(
          ({ key }) => key === fixture.cancelledByKey,
        )!;
        expect(actual.cancelledAt).toEqual(now);
        expect(actual.cancelledBy).toBe((await user(actor.email)).id);
      } else {
        expect(actual.cancelledAt).toBeNull();
        expect(actual.cancelledBy).toBeNull();
      }
    }
    expect(email.messages).toHaveLength(0);
  });

  it("is idempotent, retains user ids and moves only fixture schedules to the new operating date", async () => {
    await seed();
    const before = await database.db.select().from(users);
    const later = new Date("2026-10-14T03:00:00Z");
    await seed(later);
    expect(await counts()).toEqual(expectedCounts);
    expect(await database.db.select().from(users)).toEqual(before);
    const rows = await database.db.select().from(bookings);
    for (const fixture of fixtures.bookings) {
      const actual = rows.find(({ id }) => id === fixture.id)!;
      expect(actual.attendeeCount).toBe(attendeeCounts.get(fixture.id) ?? null);
      expect(localDate(actual.during.start, "Asia/Seoul")).toBe(
        fixture.dayOffset === 0 ? "2026-10-14" : "2026-10-15",
      );
      expect(localTime(actual.during.start, "Asia/Seoul")).toBe(fixture.start);
      expect(actual.cancelledAt).toEqual(
        fixture.status === "cancelled" ? later : null,
      );
    }
  });

  it.each([
    ["2026-10-10T03:00:00Z", "2026-10-10", "2026-10-12"],
    ["2026-10-11T03:00:00Z", "2026-10-12", "2026-10-13"],
  ])("skips closed days from %s", async (date, first, next) => {
    await seed(new Date(date));
    const rows = await database.db.select().from(bookings);
    for (const fixture of fixtures.bookings) {
      const space = fixtures.spaces.find(({ id }) => id === fixture.spaceId)!;
      const floor = fixtures.floors.find(({ id }) => id === space.floorId)!;
      const branch = fixtures.branches.find(({ id }) => id === floor.branchId)!;
      const weekendClosed =
        branch.name === "성수점" || branch.name === "여의도점";
      const actual = rows.find(({ id }) => id === fixture.id)!;
      expect(
        localDate(
          rows.find(({ id }) => id === fixture.id)!.during.start,
          "Asia/Seoul",
        ),
      ).toBe(
        weekendClosed
          ? fixture.dayOffset === 0
            ? "2026-10-12"
            : "2026-10-13"
          : fixture.dayOffset === 0
            ? first
            : next,
      );
      const date = localDate(actual.during.start, branch.timezone);
      const hours = getOpenHours(branch.openHours, date);
      expect(hours).not.toBeNull();
      expect(localDate(actual.during.end, branch.timezone)).toBe(date);
      expect(
        localTime(actual.during.start, branch.timezone) >= hours!.open,
      ).toBe(true);
      expect(
        localTime(actual.during.end, branch.timezone) <= hours!.close,
      ).toBe(true);
    }
    const blocks = await database.db.select().from(spaceBlocks);
    for (const branch of fixtures.branches.filter(({ name }) =>
      ["홍대점", "여의도점", "판교점"].includes(name),
    )) {
      const floorIds = new Set(
        fixtures.floors
          .filter((floor) => floor.branchId === branch.id)
          .map(({ id }) => id),
      );
      const spaceIds = new Set(
        fixtures.spaces
          .filter(({ floorId }) => floorIds.has(floorId))
          .map(({ id }) => id),
      );
      const matching = blocks.filter(({ spaceId }) => spaceIds.has(spaceId));
      expect(matching).toHaveLength(1);
      const block = matching[0]!;
      const date = localDate(block.during.start, branch.timezone);
      const hours = getOpenHours(branch.openHours, date);
      expect(hours).not.toBeNull();
      expect(localDate(block.during.end, branch.timezone)).toBe(date);
      expect(
        localTime(block.during.start, branch.timezone) >= hours!.open,
      ).toBe(true);
      expect(localTime(block.during.end, branch.timezone) <= hours!.close).toBe(
        true,
      );
    }
  });

  it("preserves unrelated accounts, memberships and schedules while skipping a conflicting seed booking", async () => {
    await seed();
    const outsider = await account("test1@ai.com");
    const original = fixtures.bookings[0]!;
    const [existing] = await database.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, original.id));
    await database.db.delete(bookings).where(eq(bookings.id, original.id));
    const foreignId = crypto.randomUUID();
    await database.db.insert(bookings).values({
      id: foreignId,
      spaceId: original.spaceId,
      userId: outsider.id,
      during: existing!.during,
    });
    await database.db.insert(teamMembers).values({
      userId: outsider.id,
      teamId: fixtures.teams[0]!.id,
      role: "member",
      title: "보존",
    });
    await database.db
      .insert(branchStaff)
      .values({ userId: outsider.id, branchId: fixtures.branches[0]!.id });
    const [foreignBlock] = await database.db
      .insert(spaceBlocks)
      .values({
        id: crypto.randomUUID(),
        spaceId: original.spaceId,
        during: existing!.during,
        createdBy: outsider.id,
        reason: "시드 밖 점검",
      })
      .returning();
    const result = await seed();
    expect(result.skippedBookings).toBe(1);
    expect(result.counts.bookings).toBe(29);
    expect(
      await database.db
        .select()
        .from(bookings)
        .where(eq(bookings.id, foreignId)),
    ).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(bookings)
        .where(eq(bookings.id, original.id)),
    ).toHaveLength(0);
    const [preservedBooking] = await database.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, foreignId));
    expect(preservedBooking!.attendeeCount).toBeNull();
    expect((await user(outsider.email)).name).toBe("기존 사람");
    expect((await login(outsider.email, "existing-password")).ok).toBe(true);
    expect(await getMemberships(outsider.id, database.db)).toMatchObject({
      teams: [{ teamId: fixtures.teams[0]!.id, role: "member" }],
      staffBranchIds: [fixtures.branches[0]!.id],
    });
    expect(
      await database.db
        .select()
        .from(spaceBlocks)
        .where(eq(spaceBlocks.id, foreignBlock!.id)),
    ).toEqual([foreignBlock]);
  });

  it("rolls back all seed changes when another team owns a fixture name", async () => {
    const creator = await account("existing@example.test");
    await database.db
      .insert(teams)
      .values({ name: fixtures.teams[0]!.name, createdBy: creator.id });
    await expect(seed()).rejects.toThrow(/팀 .*다른 행/);
    expect(await database.db.select().from(users)).toHaveLength(1);
    expect(await database.db.select().from(branches)).toHaveLength(0);
    expect(await database.db.select().from(teams)).toHaveLength(1);
  });

  it("rolls back a branch upsert when an unrelated floor owns its level", async () => {
    const branch = fixtures.branches[0]!;
    const floor = fixtures.floors.find((row) => row.branchId === branch.id)!;
    await database.db
      .insert(branches)
      .values({ id: branch.id, name: "보존할 이름" });
    await database.db
      .insert(floors)
      .values({ branchId: branch.id, level: floor.level, name: "기존 층" });
    await expect(seed()).rejects.toThrow(/층 .*다른 행/);
    expect((await database.db.select().from(branches))[0]!.name).toBe(
      "보존할 이름",
    );
    expect(await database.db.select().from(users)).toHaveLength(0);
  });

  it("rolls back credential resets and session revocation after a later team collision", async () => {
    const original = await account("admin@floor.com");
    const signedIn = await login(original.email, "existing-password");
    expect(signedIn.ok).toBe(true);
    const cookie = signedIn.headers.get("set-cookie")!;
    const credentials = await database.db
      .select({ password: authAccounts.password })
      .from(authAccounts)
      .where(eq(authAccounts.userId, original.id));
    const sessions = await database.db
      .select({ id: authSessions.id })
      .from(authSessions)
      .where(eq(authSessions.userId, original.id));
    expect(credentials).toHaveLength(1);
    expect(sessions).toHaveLength(1);
    await database.db
      .insert(teams)
      .values({ name: fixtures.teams[0]!.name, createdBy: original.id });

    await expect(seed(now, true)).rejects.toThrow(/팀 .*다른 행/);

    const remainingCredentials = await database.db
      .select({ password: authAccounts.password })
      .from(authAccounts)
      .where(eq(authAccounts.userId, original.id));
    expect(remainingCredentials).toHaveLength(1);
    expect(remainingCredentials[0]!.password === credentials[0]!.password).toBe(
      true,
    );
    expect(
      await database.db
        .select({ id: authSessions.id })
        .from(authSessions)
        .where(eq(authSessions.userId, original.id)),
    ).toEqual(sessions);
    const session = await auth.handler(
      new Request("http://localhost:3000/api/auth/get-session", {
        headers: { cookie },
      }),
    );
    expect(await session.json()).toMatchObject({ user: { id: original.id } });
    expect((await login(original.email, "existing-password")).ok).toBe(true);
    expect((await login(original.email, "admin1234!")).ok).toBe(false);
    expect(await database.db.select().from(users)).toHaveLength(1);
    expect(await database.db.select().from(branches)).toHaveLength(0);
  });

  it("preserves verified existing names/passwords unless reset was explicitly selected", async () => {
    const original = await account("admin@floor.com");
    const signedIn = await login(original.email, "existing-password");
    const cookie = signedIn.headers.get("set-cookie")!;
    await seed();
    expect((await user(original.email)).name).toBe("기존 사람");
    expect((await login(original.email, "existing-password")).ok).toBe(true);
    expect((await login(original.email, "admin1234!")).ok).toBe(false);
    await seed(now, true);
    expect((await login(original.email, "existing-password")).ok).toBe(false);
    expect(
      await database.db
        .select()
        .from(authSessions)
        .where(eq(authSessions.userId, original.id)),
    ).toHaveLength(0);
    expect(
      await (
        await auth.handler(
          new Request("http://localhost:3000/api/auth/get-session", {
            headers: { cookie },
          }),
        )
      ).json(),
    ).toBeNull();
    expect((await login(original.email, "admin1234!")).ok).toBe(true);
  });

  it("refuses a preempted unverified seed account and supports explicit recovery", async () => {
    const original = await account("admin@floor.com", false);
    await expect(seed()).rejects.toThrow(/인증되지 않은 기존 계정/);
    expect(await database.db.select().from(branches)).toHaveLength(0);
    expect(await database.db.select().from(users)).toHaveLength(1);
    await seed(now, true);
    expect((await user(original.email)).emailVerified).toBe(true);
    expect((await login(original.email, "existing-password")).ok).toBe(false);
    expect((await login(original.email, "admin1234!")).ok).toBe(true);
  });

  it("restores seed values and exact grants without deleting unrelated grants", async () => {
    await seed();
    const target = fixtures.accessGrants[0]!;
    await database.db
      .update(spaces)
      .set({ name: "임시 이름", archivedAt: now })
      .where(eq(spaces.id, target.targetId));
    await database.db.insert(accessGrants).values({
      ...target,
      id: crypto.randomUUID(),
      teamId: fixtures.teams.find(({ id }) => id !== target.teamId)!.id,
    });
    const foreignTarget = crypto.randomUUID();
    await database.db.insert(accessGrants).values({
      targetType: "floor",
      targetId: foreignTarget,
      teamId: target.teamId,
    });
    await seed();
    const [space] = await database.db
      .select()
      .from(spaces)
      .where(eq(spaces.id, target.targetId));
    expect(space).toMatchObject({ name: "회의실 A", archivedAt: null });
    expect(
      await database.db
        .select()
        .from(accessGrants)
        .where(eq(accessGrants.targetId, target.targetId)),
    ).toHaveLength(1);
    expect(
      await database.db
        .select()
        .from(accessGrants)
        .where(eq(accessGrants.targetId, foreignTarget)),
    ).toHaveLength(1);
  });

  it("does not replace an existing published plan or its floor pointer", async () => {
    await seed();
    const input = fixtures.floorPlans[0]!;
    const admin = await user("admin@floor.com");
    await database.db
      .update(floorPlans)
      .set({ status: "archived" })
      .where(eq(floorPlans.id, input.id));
    const otherId = crypto.randomUUID();
    await database.db.insert(floorPlans).values({
      id: otherId,
      floorId: input.floorId,
      version: 2,
      document: input.document,
      createdBy: admin.id,
      status: "published",
      publishedAt: now,
    });
    await database.db
      .update(floors)
      .set({ publishedPlanId: otherId })
      .where(eq(floors.id, input.floorId));
    expect((await seed()).counts.floorPlans).toBe(0);
    expect(
      (
        await database.db
          .select()
          .from(floors)
          .where(eq(floors.id, input.floorId))
      )[0]!.publishedPlanId,
    ).toBe(otherId);
    expect(
      (
        await database.db
          .select()
          .from(floorPlans)
          .where(eq(floorPlans.id, input.id))
      )[0]!.status,
    ).toBe("archived");
  });

  it("preserves changes to the existing fixture plan instead of replacing its document", async () => {
    await seed();
    const input = fixtures.floorPlans[0]!;
    const document = structuredClone(input.document);
    document.bounds.w += 100;
    const [before] = await database.db
      .update(floorPlans)
      .set({
        document,
        backgroundImage: "development/edited-floor.png",
        publishedAt: new Date("2026-10-01T03:00:00Z"),
      })
      .where(eq(floorPlans.id, input.id))
      .returning();

    await seed(new Date("2026-10-14T03:00:00Z"));

    expect(
      await database.db
        .select()
        .from(floorPlans)
        .where(eq(floorPlans.id, input.id)),
    ).toEqual([before]);
    expect(
      (
        await database.db
          .select({ publishedPlanId: floors.publishedPlanId })
          .from(floors)
          .where(eq(floors.id, input.floorId))
      )[0]!.publishedPlanId,
    ).toBe(input.id);
  });

  it("produces the intended general/team/operator access without extra accounts", async () => {
    await seed();
    const room = await getSpaceForAccess(
      fixtures.accessGrants[0]!.targetId,
      database.db,
    );
    expect(room).not.toBeNull();
    const floor8 = fixtures.floors.find(({ level }) => level === 8)!;
    const closed = fixtures.floors.find(({ access }) => access === "closed")!;
    for (const [email, allowedFloor, allowedRoom, allowedClosed] of [
      ["member@floor.com", false, false, false],
      ["design.member@floor.com", true, false, false],
      ["growth.admin@floor.com", false, true, false],
      ["admin@floor.com", true, true, true],
    ] as const) {
      const current = await user(email);
      const context = {
        userId: current.id,
        ...(await getMemberships(current.id, database.db)),
        roleSettings: {},
      };
      expect(canAccess(context, room!)).toBe(allowedRoom);
      expect(
        canAccessFloor(context, {
          ...floor8,
          allowedTeamIds: [fixtures.teams[0]!.id],
        }),
      ).toBe(allowedFloor);
      expect(canAccessFloor(context, { ...closed, allowedTeamIds: [] })).toBe(
        allowedClosed,
      );
    }
    expect(
      await database.db
        .select()
        .from(authAccounts)
        .where(
          and(
            eq(authAccounts.providerId, "credential"),
            sql`${authAccounts.password} is not null`,
          ),
        ),
    ).toHaveLength(6);
  });
});
