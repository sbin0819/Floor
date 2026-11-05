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
  announcements,
  authAccounts,
  authSessions,
  bookings,
  branches,
  branchStaff,
  callParticipants,
  callSessions,
  chatSpaces,
  chatSpaceMembers,
  chatRooms,
  floorPlans,
  floors,
  friendships,
  messages,
  notifications,
  reports,
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
import { loadSeedPlans } from "@/lib/seed/seed-plans";
import { expandSeedSchedule, loadSeedSchedule } from "@/lib/seed/schedule";
import { runSeed } from "@/lib/seed/run-seed";
import { createTestDatabase, type TestDatabase } from "./helper";

const now = new Date("2026-11-05T05:00:00Z");
const fixtures = loadSeedData();
const schedule = expandSeedSchedule(loadSeedSchedule(fixtures), fixtures, now);
const expectedStructure = {
  users: 21,
  branches: 5,
  floors: 11,
  spaces: 71,
  teams: 4,
  teamMembers: 16,
  branchStaff: 5,
  accessGrants: 2,
  floorPlans: 11,
  spacePhotos: 65,
  branchCovers: 5,
  chatSpaces: fixtures.teams.length + fixtures.branches.length + 2,
  communitySpaces: 2,
  friendships: 8,
  directRooms: 7,
  groupRooms: 2,
  announcements: 5,
  reports: 2,
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
        spacePhotos,
        friendships,
        announcements,
        reports,
      }).map(async ([name, table]) => [
        name,
        (await database.db.select().from(table)).length,
      ]),
    );
    const roomKind = async (kind: "meeting" | "dm" | "group_dm") =>
      (
        await database.db
          .select()
          .from(chatRooms)
          .where(eq(chatRooms.kind, kind))
      ).length;
    return {
      ...Object.fromEntries(entries),
      chatSpaces: (await database.db.select().from(chatSpaces)).length,
      communitySpaces: (
        await database.db
          .select()
          .from(chatSpaces)
          .where(eq(chatSpaces.kind, "community"))
      ).length,
      directRooms: await roomKind("dm"),
      groupRooms: await roomKind("group_dm"),
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

  it("writes the fixture structure, the whole expanded month and verified credentials without email", async () => {
    const result = await seed();
    expect(result.counts).toMatchObject({
      ...expectedStructure,
      bookings: schedule.bookings.length,
      spaceBlocks: schedule.blocks.length,
      meetingRooms: schedule.bookings.filter((row) => !row.isDesk).length,
    });
    expect(await counts()).toEqual(expectedStructure);
    expect(await database.db.select().from(bookings)).toHaveLength(
      schedule.bookings.length,
    );
    expect(await database.db.select().from(spaceBlocks)).toHaveLength(
      schedule.blocks.length,
    );
    expect(await database.db.select().from(callSessions)).toEqual([]);
    expect(await database.db.select().from(callParticipants)).toEqual([]);
    expect(result.skippedBookings).toBe(0);
    expect(result.accounts).toEqual(fixtures.users.map(({ email }) => email));
    for (const input of fixtures.users) {
      const row = await user(input.email);
      expect(row.emailVerified).toBe(true);
      expect(row.defaultBranchId).toBe(input.defaultBranchId);
      expect((await login(input.email, input.password)).status).toBe(200);
    }
    const admin = await user("admin@ai.com");
    expect(
      (await getMemberships(admin.id, database.db)).staffBranchIds.sort(),
    ).toEqual(fixtures.branches.map(({ id }) => id).sort());
    const allPlans = await database.db.select().from(floorPlans);
    const allFloors = await database.db.select().from(floors);
    for (const plan of [...fixtures.floorPlans, ...loadSeedPlans(fixtures)]) {
      expect(allPlans.find(({ id }) => id === plan.id)).toMatchObject({
        floorId: plan.floorId,
        status: "published",
        document: plan.document,
      });
      expect(
        allFloors.find(({ id }) => id === plan.floorId)?.publishedPlanId,
      ).toBe(plan.id);
    }
    // 시드 계정은 환영 알림을 받지 않는다 (계정 준비 도우미는 가입 훅을 거치지 않는다).
    expect(
      await database.db
        .select()
        .from(notifications)
        .where(eq(notifications.type, "welcome")),
    ).toEqual([]);
    expect(email.messages).toHaveLength(0);
  });

  it("is idempotent, retains user ids and moves only the schedule to the new base date", async () => {
    await seed();
    const before = await database.db.select().from(users);
    const later = new Date("2026-11-12T05:00:00Z");
    const result = await seed(later);
    expect(await counts()).toEqual(expectedStructure);
    expect(await database.db.select().from(users)).toEqual(before);
    const expected = expandSeedSchedule(
      loadSeedSchedule(fixtures),
      fixtures,
      later,
    );
    expect(result.counts.bookings).toBe(expected.bookings.length);
    const rows = await database.db.select().from(bookings);
    expect(rows).toHaveLength(expected.bookings.length);
    const byId = new Map(rows.map((row) => [row.id, row]));
    for (const booking of expected.bookings) {
      const actual = byId.get(booking.id);
      expect(actual).toBeDefined();
      expect(actual!.during.start).toEqual(booking.during.start);
      expect(actual!.status).toBe(booking.status);
      expect(actual!.cancelledAt).toEqual(booking.cancelledAt);
    }
    // 바뀐 기준일에 더는 펼쳐지지 않는 옛 id는 남지 않는다.
    expect(rows.every((row) => byId.has(row.id))).toBe(true);
    expect(await database.db.select().from(announcements)).toHaveLength(5);
    expect(await database.db.select().from(reports)).toHaveLength(2);
  });

  it("preserves unrelated accounts, memberships and schedules while skipping a conflicting seed booking", async () => {
    await seed();
    const outsider = await account("outsider@ai.com");
    const original = schedule.bookings.find(
      (row) => row.key === "design-weekly" && row.status === "confirmed",
    )!;
    await database.db.delete(bookings).where(eq(bookings.id, original.id));
    const foreignId = crypto.randomUUID();
    await database.db.insert(bookings).values({
      id: foreignId,
      spaceId: original.spaceId,
      userId: outsider.id,
      during: original.during,
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
        during: original.during,
        createdBy: outsider.id,
        reason: "시드 밖 점검",
      })
      .returning();
    const result = await seed();
    expect(result.skippedBookings).toBe(1);
    expect(result.counts.bookings).toBe(schedule.bookings.length - 1);
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

  it("does not resurrect a soft-deleted seed team and rolls back other seed updates", async () => {
    await seed();
    const [creator] = await database.db.select().from(users);
    const teamId = fixtures.teams[0]!.id;
    await database.db
      .update(teams)
      .set({
        deletedAt: new Date("2026-11-01T00:00:00Z"),
        deletedBy: creator!.id,
      })
      .where(eq(teams.id, teamId));
    await database.db
      .update(branches)
      .set({ name: "보존할 지점 이름" })
      .where(eq(branches.id, fixtures.branches[0]!.id));
    const before = await database.db
      .select()
      .from(teams)
      .where(eq(teams.id, teamId));
    await expect(seed()).rejects.toThrow(
      "지운 시드 팀이 있어요. 자동 복구하지 않으니 먼저 데이터를 확인해 주세요.",
    );
    expect(
      await database.db.select().from(teams).where(eq(teams.id, teamId)),
    ).toEqual(before);
    const [branch] = await database.db
      .select()
      .from(branches)
      .where(eq(branches.id, fixtures.branches[0]!.id));
    expect(branch!.name).toBe("보존할 지점 이름");
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
    const original = await account("admin@ai.com");
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
    expect((await login(original.email, "qwer1234")).ok).toBe(false);
    expect(await database.db.select().from(users)).toHaveLength(1);
    expect(await database.db.select().from(branches)).toHaveLength(0);
  });

  it("preserves verified existing names, passwords and default branch unless reset was explicitly selected", async () => {
    const original = await account("admin@ai.com");
    const otherBranch = fixtures.branches[1]!;
    const signedIn = await login(original.email, "existing-password");
    const cookie = signedIn.headers.get("set-cookie")!;
    await seed();
    expect((await user(original.email)).name).toBe("기존 사람");
    expect((await login(original.email, "existing-password")).ok).toBe(true);
    expect((await login(original.email, "qwer1234")).ok).toBe(false);
    // 비어 있던 기본 지점은 채우고, 이미 정한 기본 지점은 다시 돌려도 바꾸지 않는다.
    expect((await user(original.email)).defaultBranchId).toBe(
      fixtures.users[0]!.defaultBranchId,
    );
    await database.db
      .update(users)
      .set({ defaultBranchId: otherBranch.id })
      .where(eq(users.id, original.id));
    await seed(now, true);
    expect((await user(original.email)).defaultBranchId).toBe(otherBranch.id);
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
    expect((await login(original.email, "qwer1234")).ok).toBe(true);
  });

  it("refuses a preempted unverified seed account and supports explicit recovery", async () => {
    const original = await account("admin@ai.com", false);
    await expect(seed()).rejects.toThrow(/인증되지 않은 기존 계정/);
    expect(await database.db.select().from(branches)).toHaveLength(0);
    expect(await database.db.select().from(users)).toHaveLength(1);
    await seed(now, true);
    expect((await user(original.email)).emailVerified).toBe(true);
    expect((await login(original.email, "existing-password")).ok).toBe(false);
    expect((await login(original.email, "qwer1234")).ok).toBe(true);
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
    const admin = await user("admin@ai.com");
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
    expect((await seed()).counts.floorPlans).toBe(10);
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

  it("produces the intended general, team and operator access for the four teams", async () => {
    await seed();
    const room = await getSpaceForAccess(
      fixtures.accessGrants[0]!.targetId,
      database.db,
    );
    expect(room).not.toBeNull();
    const floor8 = fixtures.floors.find(({ level }) => level === 8)!;
    const closed = fixtures.floors.find(({ access }) => access === "closed")!;
    for (const [email, allowedFloor, allowedRoom, allowedClosed] of [
      ["test1@ai.com", false, false, false],
      ["test3@ai.com", true, false, false],
      ["test4@ai.com", false, true, false],
      ["test6@ai.com", false, false, false],
      ["admin@ai.com", true, true, true],
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
    ).toHaveLength(21);
    expect(
      (await database.db.select().from(chatSpaceMembers)).length,
    ).toBeGreaterThan(20);
    expect(await database.db.select().from(messages)).not.toHaveLength(0);
  });
});
