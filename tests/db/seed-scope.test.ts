import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
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
import seedFile from "@/docs/spec/examples/seed.json";
import spacesFile from "@/docs/spec/examples/gangnam-7f.spaces.json";
import planFile from "@/docs/spec/examples/gangnam-7f.plan.json";
import photoFile from "@/docs/spec/examples/seed-photos.json";
import scheduleFile from "@/docs/spec/examples/seed-schedule.json";
import * as authModule from "@/lib/auth/auth";
import * as scheduleDal from "@/lib/dal/seed-schedule";
import * as schema from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import { preflightSeedBranches } from "@/lib/seed/add-branches";
import * as dataLoader from "@/lib/seed/data";
import * as photoLoader from "@/lib/seed/photos";
import * as planLoader from "@/lib/seed/seed-plans";
import * as scheduleLoader from "@/lib/seed/schedule";
import { runSeed } from "@/lib/seed/run-seed";
import { localDate, localTime } from "@/lib/time/zoned";
import { createTestDatabase, type TestDatabase } from "./helper";

const {
  users,
  authAccounts,
  authSessions,
  authVerifications,
  branches,
  floors,
  spaces,
  spacePhotos,
  teams,
  teamMembers,
  branchStaff,
  accessGrants,
  floorPlans,
  bookings,
  spaceBlocks,
  chatRooms,
  messages,
  chatRoomReads,
} = schema;
const now = new Date("2026-10-07T03:00:00Z");
const base = dataLoader.loadSeedData();
const baseSchedule = scheduleLoader.expandSeedSchedule(
  scheduleLoader.loadSeedSchedule(base),
  base,
  now,
);
const ids = {
  branch: crypto.randomUUID(),
  firstFloor: crypto.randomUUID(),
  secondFloor: crypto.randomUUID(),
  firstSpace: crypto.randomUUID(),
  secondSpace: crypto.randomUUID(),
  booking: scheduleLoader.seedScheduleId("oneoff:scope-added-booking"),
  cancelled: scheduleLoader.seedScheduleId("oneoff:scope-added-cancelled"),
  block: scheduleLoader.seedScheduleId("block:scope-added-block"),
};

// 신규 실제 fixture와 별개로, 이 테스트는 확장 전 두 지점 데이터만 있어도 실행된다.
function extension() {
  const raw = structuredClone(seedFile);
  raw.branches.push({
    ...raw.branches[1]!,
    id: ids.branch,
    name: "추가 검증 지점",
  });
  raw.floors.push(
    {
      id: ids.firstFloor,
      branchId: ids.branch,
      level: 1,
      name: "1F",
      sortOrder: 0,
      access: "everyone",
    },
    {
      id: ids.secondFloor,
      branchId: ids.branch,
      level: 2,
      name: "2F",
      sortOrder: 1,
      access: "everyone",
    },
  );
  raw.spaces.push(
    {
      ...raw.spaces[0]!,
      id: ids.firstSpace,
      floorId: ids.firstFloor,
      name: "추가 회의실 1",
      access: null,
    },
    {
      ...raw.spaces[0]!,
      id: ids.secondSpace,
      floorId: ids.secondFloor,
      name: "추가 회의실 2",
      access: null,
    },
  );
  raw.branchStaff.push({ branchId: ids.branch, userKey: "admin" });
  const data = dataLoader.parseSeedData({
    seed: raw,
    spaces: spacesFile,
    plan: planFile,
  });
  // 새 지점의 일정은 전체 일정 파일에 한 번짜리 예약 두 개와 점검 하나를 더해 만든다.
  const scheduleInput = structuredClone(scheduleFile) as unknown as {
    oneOff: Record<string, unknown>[];
    maintenance: Record<string, unknown>[];
  };
  scheduleInput.oneOff.push(
    {
      key: "scope-added-booking",
      spaceId: ids.firstSpace,
      dayOffset: 0,
      start: "10:00",
      end: "11:00",
      userKey: "member",
      teamId: null,
      title: "추가 예약",
      attendeeCount: null,
      participantKeys: [],
      createdDaysBefore: 1,
    },
    {
      key: "scope-added-cancelled",
      spaceId: ids.secondSpace,
      dayOffset: 1,
      start: "11:00",
      end: "12:00",
      userKey: "member",
      teamId: null,
      title: null,
      attendeeCount: null,
      participantKeys: [],
      createdDaysBefore: 1,
      status: "cancelled",
      cancelledByKey: "member",
    },
  );
  scheduleInput.maintenance.push({
    key: "scope-added-block",
    spaceId: ids.firstSpace,
    startDayOffset: 0,
    start: "15:00",
    endDayOffset: 0,
    end: "16:00",
    reason: "추가 점검",
    createdByKey: "admin",
  });
  const schedule = scheduleLoader.parseSeedSchedule(scheduleInput, data);
  const photoInput = structuredClone(photoFile);
  photoInput.branchCovers.push({
    ...photoInput.branchCovers[0]!,
    branchId: ids.branch,
    name: "추가 검증 지점",
  });
  for (const spaceId of [ids.firstSpace, ids.secondSpace])
    photoInput.spacePhotos.push({
      spaceId,
      name: "추가 회의실",
      photos: [photoInput.spacePhotos[0]!.photos[0]!],
    });
  return {
    data,
    photos: photoLoader.parseSeedPhotos(photoInput, data),
    schedule,
  };
}
const fixtures = extension();

describe("transactional additive-only branch seed", () => {
  let database: TestDatabase;
  let auth: authModule.AuthInstance;
  const statements: string[] = [];
  const statementParameters: unknown[][] = [];
  const expected = {
    users: 0,
    branches: 1,
    floors: 2,
    spaces: 2,
    teams: 0,
    teamMembers: 0,
    branchStaff: 1,
    accessGrants: 0,
    floorPlans: 0,
    bookings: 2,
    spaceBlocks: 1,
    announcements: 0,
    spacePhotos: 2,
    branchCovers: 1,
    meetingRooms: 2,
    // 예약을 만든 시스템 메시지 둘과 취소 시스템 메시지 하나.
    chatMessages: 3,
    chatSpaces: 1,
    communitySpaces: 0,
    spaceMembers: 0,
  };
  beforeAll(async () => {
    database = await createTestDatabase();
    auth = authModule.createAuth({
      db: database.db,
      email: createMemoryEmailSender(),
      secret: "additive-seed-test-secret-at-least-32-bytes",
      baseUrl: "http://localhost:3000",
      rateLimit: { enabled: false },
    });
  });
  afterAll(async () => {
    await database?.client.close();
  });
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    await database.db.execute(
      sql`TRUNCATE users, branches, auth_verifications CASCADE`,
    );
    await runSeed({ db: database.db, auth, now, resetPasswords: false });
    vi.spyOn(dataLoader, "loadSeedData").mockReturnValue(
      structuredClone(fixtures.data),
    );
    vi.spyOn(photoLoader, "loadSeedPhotos").mockReturnValue(
      structuredClone(fixtures.photos),
    );
    vi.spyOn(scheduleLoader, "loadSeedSchedule").mockReturnValue(
      structuredClone(fixtures.schedule),
    );
    vi.spyOn(planLoader, "loadSeedPlans").mockImplementation(() => {
      throw new Error("Scoped seed must not load additional floor plans");
    });
    vi.spyOn(authModule, "getAuth").mockImplementation(() => {
      throw new Error("Scoped seed must not initialize auth");
    });
    vi.spyOn(authModule, "createProvisioningAuth").mockRejectedValue(
      new Error("Scoped seed must not provision users"),
    );
    statements.length = 0;
    statementParameters.length = 0;
  });
  const loggingDb = () =>
    drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(query, params) {
          statements.push(query);
          statementParameters.push(params);
        },
      },
    });
  const append = (branchIds = [ids.branch], date = now) =>
    runSeed({ db: loggingDb(), now: date, resetPasswords: false, branchIds });
  async function snapshot() {
    const result: Record<string, string[]> = {};
    for (const [name, table] of Object.entries({
      users,
      authAccounts,
      authSessions,
      authVerifications,
      chatRooms,
      messages,
      chatRoomReads,
      branches,
      floors,
      spaces,
      spacePhotos,
      teams,
      teamMembers,
      branchStaff,
      accessGrants,
      floorPlans,
      bookings,
      spaceBlocks,
    }))
      result[name] = (await database.db.select().from(table))
        .map((row) => JSON.stringify(row))
        .sort();
    return result;
  }
  async function memberId() {
    return (
      await database.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, "test1@ai.com"))
    )[0]!.id;
  }

  it("preflights without writes and inserts only the selected new bundle, reusing existing accounts", async () => {
    const session = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({
          email: "test1@ai.com",
          password: "qwer1234",
        }),
      }),
    );
    expect(session.status).toBe(200);
    expect(await database.db.select().from(authSessions)).toHaveLength(1);
    const before = await snapshot();
    expect(
      await preflightSeedBranches({
        branchIds: [ids.branch],
        db: loggingDb(),
        now,
      }),
    ).toEqual({
      addedBranchIds: [ids.branch],
      skippedBranchIds: [],
      expectedCounts: expected,
    });
    expect(statements.every((statement) => /^select\b/i.test(statement))).toBe(
      true,
    );
    expect(await snapshot()).toEqual(before);
    statements.length = 0;
    statementParameters.length = 0;
    const result = await append();
    expect(result).toMatchObject({
      counts: expected,
      skippedBookings: 0,
      branchScope: { addedBranchIds: [ids.branch], skippedBranchIds: [] },
    });
    expect(result.accounts.sort()).toEqual(["admin@ai.com", "test1@ai.com"]);
    const after = await snapshot();
    for (const [table, rows] of Object.entries(before))
      expect(after[table]).toEqual(expect.arrayContaining(rows));
    for (const table of [
      "users",
      "authAccounts",
      "authSessions",
      "authVerifications",
      "teams",
      "teamMembers",
      "accessGrants",
      "floorPlans",
    ])
      expect(after[table]).toEqual(before[table]);
    expect(
      await database.db
        .select({ name: chatRooms.name, capacity: chatRooms.voiceCapacity })
        .from(chatRooms)
        .innerJoin(
          schema.chatSpaces,
          eq(chatRooms.spaceId, schema.chatSpaces.id),
        )
        .where(
          sql`${schema.chatSpaces.branchId} = ${ids.branch} and ${chatRooms.kind} = 'voice'`,
        ),
    ).toEqual([{ name: "라운지-음성", capacity: 10 }]);
    const newRooms = await database.db
      .select()
      .from(chatRooms)
      .where(sql`${chatRooms.bookingId} in (${ids.booking}, ${ids.cancelled})`);
    expect(newRooms).toHaveLength(2);
    const newRoomIds = new Set(newRooms.map(({ id }) => id));
    // 자기 id의 예약·점검을 지우는 문장 밖에는 기존 행을 바꾸는 쓰기가 없다.
    const updates = statements.flatMap((statement, index) =>
      /^(update|delete)\b/i.test(statement)
        ? [{ statement, params: statementParameters[index]! }]
        : [],
    );
    expect(
      updates.every(({ statement }) =>
        /^delete from "(bookings|space_blocks|announcements|messages|notifications)"/i.test(
          statement,
        ),
      ),
    ).toBe(true);
    expect(newRoomIds.size).toBe(2);
    expect(
      statements.filter((statement) =>
        /insert into "(users|auth_|teams|team_members)/i.test(statement),
      ),
    ).toEqual([]);
    expect(authModule.getAuth).not.toHaveBeenCalled();
    expect(authModule.createProvisioningAuth).not.toHaveBeenCalled();
    const [created] = await database.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, ids.booking));
    expect(localDate(created!.during.start, "Asia/Seoul")).toBe("2026-10-07");
    expect(localTime(created!.during.start, "Asia/Seoul")).toBe("10:00");
    expect(created!.userId).toBe(await memberId());
    const [cancelled] = await database.db
      .select()
      .from(bookings)
      .where(eq(bookings.id, ids.cancelled));
    expect(cancelled).toMatchObject({
      status: "cancelled",
      cancelledAt: expect.any(Date),
      cancelledBy: await memberId(),
    });
    expect(cancelled!.cancelledAt! <= now).toBe(true);
  });

  it("leaves settings, changed photos, cancellations, accounts and dates exactly unchanged on rerun", async () => {
    await append();
    await database.db
      .update(branches)
      .set({
        name: "운영자가 바꾼 이름",
        openHours: { sun: { open: "10:00", close: "16:00" } },
        coverPhotoPath: "/seed/photos/changed.webp",
        coverPhotoAlt: "변경",
      })
      .where(eq(branches.id, ids.branch));
    await database.db
      .update(floors)
      .set({ name: "수정 층", access: "closed", level: 30 })
      .where(eq(floors.id, ids.firstFloor));
    await database.db
      .update(spaces)
      .set({
        name: "보관한 공간",
        archivedAt: now,
        bookingRules: { custom: true },
        bookable: false,
      })
      .where(eq(spaces.id, ids.firstSpace));
    await database.db
      .update(spacePhotos)
      .set({ path: "/seed/photos/changed.webp", alt: "수정 사진" })
      .where(eq(spacePhotos.spaceId, ids.firstSpace));
    await database.db
      .update(bookings)
      .set({
        status: "cancelled",
        cancelledAt: now,
        cancelledBy: await memberId(),
      })
      .where(eq(bookings.id, ids.booking));
    await database.db
      .update(users)
      .set({ name: "바뀐 사용자 이름" })
      .where(eq(users.email, "test1@ai.com"));
    const before = await snapshot();
    statements.length = 0;
    statementParameters.length = 0;
    const result = await append([ids.branch], new Date("2026-11-21T03:00:00Z"));
    expect(result.branchScope).toEqual({
      addedBranchIds: [],
      skippedBranchIds: [ids.branch],
    });
    expect(Object.values(result.counts).every((count) => count === 0)).toBe(
      true,
    );
    expect(result.accounts).toEqual([]);
    expect(await snapshot()).toEqual(before);
    expect(
      statements.filter((statement) =>
        /^(insert|update|delete)\b/i.test(statement),
      ),
    ).toEqual([]);
  });

  it("supports existing and absent branch scopes in one transaction without syncing existing rows", async () => {
    const existing = base.branches.find(({ name }) => name === "강남점")!;
    await database.db
      .update(bookings)
      .set({ attendeeCount: 1 })
      .where(
        eq(
          bookings.id,
          baseSchedule.bookings.find(
            (booking) => booking.key === "design-weekly",
          )!.id,
        ),
      );
    await database.db
      .update(branches)
      .set({ address: "기존 편집 유지" })
      .where(eq(branches.id, existing.id));
    const before = await snapshot();
    const result = await append([existing.id, ids.branch]);
    expect(result.branchScope).toEqual({
      addedBranchIds: [ids.branch],
      skippedBranchIds: [existing.id],
    });
    expect(result.counts).toMatchObject(expected);
    const after = await snapshot();
    for (const [table, rows] of Object.entries(before))
      expect(after[table]).toEqual(expect.arrayContaining(rows));
  });

  it("rolls back all new structures and blocks after a late booking failure", async () => {
    const before = await snapshot();
    vi.spyOn(scheduleDal, "insertSeedBookings").mockRejectedValueOnce(
      new Error("private-query-values"),
    );
    await expect(append()).rejects.toThrow("되돌렸어요");
    expect(await snapshot()).toEqual(before);
    expect(authModule.getAuth).not.toHaveBeenCalled();
  });

  it("keeps the addition inside the caller's outer transaction and rolls it back with an audit failure", async () => {
    const before = await snapshot();
    await expect(
      loggingDb().transaction(async (transaction) => {
        const result = await runSeed({
          db: transaction,
          now,
          resetPasswords: false,
          branchIds: [ids.branch],
        });
        expect(result.branchScope?.addedBranchIds).toEqual([ids.branch]);
        expect(
          await transaction
            .select()
            .from(branches)
            .where(eq(branches.id, ids.branch)),
        ).toHaveLength(1);
        throw new Error("Post-insert audit rejected");
      }),
    ).rejects.toThrow("Post-insert audit rejected");
    expect(await snapshot()).toEqual(before);
    expect(
      statements.some((statement) => /^savepoint\b/i.test(statement)),
    ).toBe(true);
  });

  it("rolls back new structures on a real unique-constraint violation without overwriting an existing row", async () => {
    const changed = structuredClone(fixtures.data);
    const first = changed.spaces.find(({ id }) => id === ids.firstSpace)!;
    const second = changed.spaces.find(({ id }) => id === ids.secondSpace)!;
    second.floorId = first.floorId;
    second.name = first.name;
    vi.mocked(dataLoader.loadSeedData).mockReturnValue(changed);
    const before = await snapshot();
    await expect(append()).rejects.toThrow("같은 고유 값");
    expect(await snapshot()).toEqual(before);
  });

  it.each(["root-only", "wrong-floor-parent", "same-name"])(
    "rejects preflight conflicts without writes: %s",
    async (kind) => {
      if (kind === "root-only")
        await database.db
          .insert(branches)
          .values({ id: ids.branch, name: "부분 데이터" });
      if (kind === "wrong-floor-parent")
        await database.db.insert(floors).values({
          id: ids.firstFloor,
          branchId: base.branches[0]!.id,
          level: 91,
          name: "다른 층",
        });
      if (kind === "same-name")
        await database.db.insert(branches).values({ name: "추가 검증 지점" });
      const before = await snapshot();
      await expect(append()).rejects.toThrow(/고정 ID|지점의 이름/);
      expect(await snapshot()).toEqual(before);
      expect(
        statements.filter((statement) =>
          /^(insert|update|delete)\b/i.test(statement),
        ),
      ).toEqual([]);
    },
  );

  it.each(["floor", "operator", "photo", "cover"])(
    "refuses to repair an existing incomplete or reparented bundle: %s",
    async (kind) => {
      await append();
      if (kind === "floor")
        await database.db
          .update(floors)
          .set({ branchId: base.branches[0]!.id, level: 91 })
          .where(eq(floors.id, ids.firstFloor));
      if (kind === "operator")
        await database.db
          .delete(branchStaff)
          .where(eq(branchStaff.branchId, ids.branch));
      if (kind === "photo")
        await database.db
          .delete(spacePhotos)
          .where(eq(spacePhotos.spaceId, ids.firstSpace));
      if (kind === "cover")
        await database.db
          .update(branches)
          .set({ coverPhotoPath: null, coverPhotoAlt: null })
          .where(eq(branches.id, ids.branch));
      const before = await snapshot();
      await expect(append()).rejects.toThrow(/고정 ID|운영자 소속|사진/);
      expect(await snapshot()).toEqual(before);
    },
  );

  it("refuses unverified existing accounts without credential repair or any writes", async () => {
    await database.db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.email, "test1@ai.com"));
    const before = await snapshot();
    await expect(append()).rejects.toThrow("인증 완료 시드 계정");
    expect(await snapshot()).toEqual(before);
    expect(authModule.createProvisioningAuth).not.toHaveBeenCalled();
  });

  it("does not involve an unrelated unverified account in the selected branch's scope", async () => {
    await database.db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.email, "test4@ai.com"));
    const before = await database.db.select().from(users).orderBy(users.id);
    expect((await append()).branchScope?.addedBranchIds).toEqual([ids.branch]);
    expect(await database.db.select().from(users).orderBy(users.id)).toEqual(
      before,
    );
  });

  it("fails on absent accounts instead of creating them", async () => {
    await database.db.execute(
      sql`TRUNCATE users, branches, auth_verifications CASCADE`,
    );
    await expect(append()).rejects.toThrow("인증 완료 시드 계정");
    expect(await database.db.select().from(users)).toEqual([]);
    expect(await database.db.select().from(branches)).toEqual([]);
    expect(authModule.createProvisioningAuth).not.toHaveBeenCalled();
  });
});
