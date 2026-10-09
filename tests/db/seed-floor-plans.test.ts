import { and, eq, sql } from "drizzle-orm";
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
import * as schema from "@/lib/db/schema";
import * as authModule from "@/lib/auth/auth";
import * as planDal from "@/lib/dal/seed-floor-plans";
import {
  captureSeedRound2Audit,
  compareSeedRound2Audit,
} from "@/lib/dal/seed-round2-audit";
import { loadSeedData } from "@/lib/seed/data";
import { loadSeedPlans } from "@/lib/seed/plans";
import {
  hashFloorPlansValue,
  type FloorPlansReceipt,
} from "@/lib/seed/floor-plans-receipt";
import { runSeed } from "@/lib/seed/run-seed";
import { SeedError } from "@/lib/seed/errors";
import { createTestDatabase, type TestDatabase } from "./helper";

const { users, branches, floors, spaces, floorPlans } = schema;
const data = loadSeedData();
const plans = [...data.floorPlans, ...loadSeedPlans(data)];
const now = new Date("2026-10-12T03:00:00Z");
const admin = "00000000-0000-4000-8000-000000000001";

describe("append-only floor plan seed", () => {
  let database: TestDatabase;
  let databaseName: string;
  const statements: string[] = [];
  beforeAll(async () => {
    database = await createTestDatabase();
    database.db = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(query) {
          statements.push(query);
        },
      },
    });
    databaseName = (
      await database.client.query<{ name: string }>(
        "select current_database() as name",
      )
    ).rows[0]!.name;
  });
  afterAll(async () => {
    await database.client.close();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });
  beforeEach(async () => {
    await database.db.execute(sql`TRUNCATE users, branches CASCADE`);
    await database.db.insert(users).values({
      id: admin,
      email: data.users.find(({ key }) => key === "admin")!.email,
      name: "기존 운영자",
      emailVerified: true,
    });
    await database.db.insert(branches).values(data.branches);
    await database.db.insert(floors).values(data.floors);
    await database.db.insert(spaces).values(data.spaces);
    statements.length = 0;
  });
  const apply = (
    receipt: FloorPlansReceipt | null = null,
    extra: Partial<Parameters<typeof runSeed>[0]> = {},
  ) =>
    runSeed({
      db: database.db,
      now,
      resetPasswords: false,
      floorPlans: {
        targetHash: hashFloorPlansValue(["fake.seed.test", databaseName]),
        databaseName,
        receipt,
      },
      ...extra,
    });
  const writes = () =>
    statements.filter((query) => /^(insert|update|delete)\b/iu.test(query));
  const insertExisting = async (
    index: number,
    status: "draft" | "published" | "archived",
    id = crypto.randomUUID(),
  ) => {
    const plan = plans[index]!;
    await database.db.insert(floorPlans).values({
      id,
      floorId: plan.floorId,
      version: plan.version,
      document: plan.document,
      status,
      createdBy: admin,
      publishedAt: status === "published" ? now : null,
    });
    if (status === "published")
      await database.db
        .update(floors)
        .set({ publishedPlanId: id })
        .where(eq(floors.id, plan.floorId));
    return id;
  };
  it("inserts eleven published plans and changes only the new rows and null floor pointers", async () => {
    const getAuth = vi.spyOn(authModule, "getAuth");
    await database.db.insert(schema.bookings).values({
      spaceId: plans[0]!.document.spaces[0]!.spaceId,
      userId: admin,
      title: "보존할 기존 예약",
      during: { start: now, end: new Date(now.getTime() + 3_600_000) },
    });
    const [community] = await database.db
      .insert(schema.chatSpaces)
      .values({
        kind: "community",
        name: "보존할 대화",
        createdBy: admin,
      })
      .returning();
    const [room] = await database.db
      .insert(schema.chatRooms)
      .values({
        kind: "text",
        name: "기존채널",
        spaceId: community!.id,
        lastSeq: 1,
        lastMessageAt: now,
      })
      .returning();
    await database.db.insert(schema.messages).values({
      roomId: room!.id,
      seq: 1,
      authorId: admin,
      kind: "text",
      body: "기존 대화 그대로",
      createdAt: now,
    });
    const before = await captureSeedRound2Audit({}, database.db);
    statements.length = 0;
    const result = await apply();
    expect(result.counts).toEqual({ floorPlans: 11 });
    expect(result.floorPlans?.receipt.added).toHaveLength(11);
    expect(result.floorPlans?.receipt.skippedFloorIds).toEqual([]);
    const rows = await database.db.select().from(floorPlans);
    expect(rows).toHaveLength(11);
    for (const plan of plans) {
      expect(rows.find(({ id }) => id === plan.id)).toMatchObject({
        id: plan.id,
        floorId: plan.floorId,
        version: plan.version,
        document: plan.document,
        createdBy: admin,
        createdAt: now,
        publishedAt: now,
        status: "published",
      });
      expect(
        (
          await database.db
            .select()
            .from(floors)
            .where(eq(floors.id, plan.floorId))
        )[0]!.publishedPlanId,
      ).toBe(plan.id);
    }
    const after = await captureSeedRound2Audit({}, database.db);
    const changes = compareSeedRound2Audit(before, after);
    expect(changes.issues).toHaveLength(11);
    expect(
      changes.issues.every(
        ({ table, kind }) => table === "floors" && kind === "changed_row",
      ),
    ).toBe(true);
    expect(changes.added).toEqual([
      { table: "floor_plans", count: 11, keys: expect.any(Array) },
    ]);
    expect(getAuth).not.toHaveBeenCalled();
    expect(writes()).toHaveLength(22);
    expect(
      writes().every((query) =>
        /^(insert into "floor_plans"|update "floors")/u.test(query),
      ),
    ).toBe(true);
  });
  it("preserves existing published, draft and archived plans and pointers, including the original fixed ID", async () => {
    const ids = [
      await insertExisting(0, "published", plans[0]!.id),
      await insertExisting(1, "draft"),
      await insertExisting(2, "archived"),
    ];
    const before = await database.db.select().from(floorPlans);
    const result = await apply();
    expect(result.counts.floorPlans).toBe(8);
    expect(result.floorPlans!.receipt.skippedFloorIds.sort()).toEqual(
      plans
        .slice(0, 3)
        .map(({ floorId }) => floorId)
        .sort(),
    );
    const rows = await database.db.select().from(floorPlans);
    expect(rows.filter(({ id }) => ids.includes(id))).toEqual(before);
    for (const plan of plans.slice(1, 3))
      expect(
        (
          await database.db
            .select()
            .from(floors)
            .where(eq(floors.id, plan.floorId))
        )[0]!.publishedPlanId,
      ).toBeNull();
  });
  it("does no writes on receipt replay and never repairs later document, publication or pointer changes", async () => {
    const receipt = (await apply()).floorPlans!.receipt;
    const first = plans[0]!;
    await database.db
      .update(floorPlans)
      .set({
        status: "archived",
        document: {
          ...first.document,
          bounds: { ...first.document.bounds, w: first.document.bounds.w + 1 },
        },
      })
      .where(eq(floorPlans.id, first.id));
    await database.db
      .update(floors)
      .set({ publishedPlanId: null })
      .where(eq(floors.id, first.floorId));
    const before = await captureSeedRound2Audit({}, database.db);
    statements.length = 0;
    expect((await apply(receipt)).floorPlans).toEqual({
      applied: false,
      receipt,
    });
    expect(writes()).toEqual([]);
    expect(
      compareSeedRound2Audit(
        before,
        await captureSeedRound2Audit({}, database.db),
      ),
    ).toEqual({ ok: true, issues: [], added: [] });
  });
  it("also performs no writes without a receipt when every floor already has a plan", async () => {
    await apply();
    statements.length = 0;
    const result = await apply();
    expect(result.counts.floorPlans).toBe(0);
    expect(result.floorPlans!.receipt.skippedFloorIds).toHaveLength(11);
    expect(writes()).toEqual([]);
  });
  it.each([
    "missing floor",
    "wrong floor parent",
    "missing space",
    "wrong space parent",
    "missing author",
    "unverified author",
    "fixed ID collision",
    "foreign pointer",
  ])("rejects %s before changing data", async (kind) => {
    const first = plans[0]!;
    if (kind === "missing floor")
      await database.db
        .delete(spaces)
        .where(eq(spaces.floorId, first.floorId))
        .then(() =>
          database.db.delete(floors).where(eq(floors.id, first.floorId)),
        );
    if (kind === "wrong floor parent")
      await database.db
        .update(floors)
        .set({
          branchId: data.branches.find(
            ({ id }) =>
              id !==
              data.floors.find(({ id }) => id === first.floorId)!.branchId,
          )!.id,
        })
        .where(eq(floors.id, first.floorId));
    if (kind === "missing space")
      await database.db
        .delete(spaces)
        .where(
          and(
            eq(spaces.floorId, plans[1]!.floorId),
            eq(spaces.id, plans[1]!.document.spaces[0]!.spaceId),
          ),
        );
    if (kind === "wrong space parent")
      await database.db
        .update(spaces)
        .set({ floorId: plans[1]!.floorId })
        .where(eq(spaces.id, first.document.spaces[0]!.spaceId));
    if (kind === "missing author") await database.db.delete(users);
    if (kind === "unverified author")
      await database.db.update(users).set({ emailVerified: false });
    if (kind === "fixed ID collision")
      await insertExisting(1, "draft", first.id);
    if (kind === "foreign pointer") {
      const id = await insertExisting(1, "published");
      await database.db
        .update(floors)
        .set({ publishedPlanId: id })
        .where(eq(floors.id, first.floorId));
    }
    const before = await captureSeedRound2Audit({}, database.db);
    statements.length = 0;
    await expect(apply()).rejects.toThrow(SeedError);
    expect(writes()).toEqual([]);
    expect(
      compareSeedRound2Audit(
        before,
        await captureSeedRound2Audit({}, database.db),
      ),
    ).toEqual({ ok: true, issues: [], added: [] });
  });
  it("rolls back all inserted plans and floor pointers after an intermediate failure", async () => {
    const insert = planDal.insertSeedFloorPlan;
    let calls = 0;
    vi.spyOn(planDal, "insertSeedFloorPlan").mockImplementation(
      async (...args) => {
        if (++calls === 3) throw new Error("fixture failure");
        return insert(...args);
      },
    );
    const before = await captureSeedRound2Audit({}, database.db);
    await expect(apply()).rejects.toThrow(SeedError);
    expect(
      compareSeedRound2Audit(
        before,
        await captureSeedRound2Audit({}, database.db),
      ),
    ).toEqual({ ok: true, issues: [], added: [] });
  });
  it.each([
    "manifest",
    "future",
    "coverage",
    "creator",
    "missing anchor",
    "database",
  ])("rejects %s drift without repair", async (kind) => {
    const receipt = (await apply()).floorPlans!.receipt;
    if (kind === "manifest") receipt.manifestHash = "0".repeat(64);
    if (kind === "future") receipt.appliedAt = "2099-01-01T00:00:00.000Z";
    if (kind === "coverage") receipt.added.pop();
    if (kind === "creator") receipt.added[0]!.createdBy = crypto.randomUUID();
    if (kind === "missing anchor") {
      const target = receipt.added[0]!;
      await database.db
        .update(floors)
        .set({ publishedPlanId: null })
        .where(eq(floors.id, target.floorId));
      await database.db.delete(floorPlans).where(eq(floorPlans.id, target.id));
    }
    statements.length = 0;
    await expect(
      apply(
        receipt,
        kind === "database"
          ? {
              floorPlans: {
                targetHash: receipt.targetHash,
                receipt,
                databaseName: "wrong-db",
              },
            }
          : {},
      ),
    ).rejects.toThrow(SeedError);
    expect(writes()).toEqual([]);
  });
  it.each([
    { resetPasswords: true },
    { resetData: true },
    { branchIds: [data.branches[0]!.id] },
    { bookingRound2: { hostHash: "a".repeat(64), receipt: null } },
    {
      chatSpaces: {
        targetHash: "a".repeat(64),
        databaseName: "postgres",
        receipt: null,
      },
    },
  ])(
    "rejects exclusive mode %j before opening a transaction",
    async (extra) => {
      const transaction = vi.spyOn(database.db, "transaction");
      await expect(apply(null, extra)).rejects.toThrow(SeedError);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});
