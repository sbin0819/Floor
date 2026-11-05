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
import * as schema from "@/lib/db/schema";
import * as authModule from "@/lib/auth/auth";
import * as seedDal from "@/lib/dal/seed";
import { loadSeedData } from "@/lib/seed/data";
import { loadSeedPlans } from "@/lib/seed/seed-plans";
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

type TableSnapshot = Map<string, Map<string, string>>;
// 공개 스키마의 모든 표를 행 단위로 찍어, 평면도 추가가 다른 행을 건드리지 않는지 확인한다.
async function captureTables(db: TestDatabase["db"]): Promise<TableSnapshot> {
  const tables = await db.execute<{ name: string }>(
    sql`select table_name as name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
  );
  const snapshot: TableSnapshot = new Map();
  for (const { name } of tables.rows) {
    const rows = await db.execute<{ row: Record<string, unknown> }>(
      sql`select to_jsonb(t) as row from ${sql.identifier(name)} t`,
    );
    const entries = rows.rows.map(({ row }) => {
      const json = JSON.stringify(row);
      return [typeof row.id === "string" ? row.id : json, json] as const;
    });
    snapshot.set(name, new Map(entries));
  }
  return snapshot;
}
function compareTables(before: TableSnapshot, after: TableSnapshot) {
  const issues: { table: string; kind: "changed_row" | "removed_row" }[] = [];
  const added: { table: string; count: number; keys: string[] }[] = [];
  for (const [table, rows] of after) {
    const previous = before.get(table) ?? new Map<string, string>();
    const keys: string[] = [];
    for (const [key, json] of rows) {
      const old = previous.get(key);
      if (old === undefined) keys.push(key);
      else if (old !== json) issues.push({ table, kind: "changed_row" });
    }
    for (const key of previous.keys())
      if (!rows.has(key)) issues.push({ table, kind: "removed_row" });
    if (keys.length) added.push({ table, count: keys.length, keys });
  }
  return { ok: issues.length === 0 && added.length === 0, issues, added };
}
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
    const before = await captureTables(database.db);
    statements.length = 0;
    const result = await apply();
    expect(result.counts).toEqual({ floorPlans: 11 });
    expect(result.floorPlans?.receipt.added).toHaveLength(11);
    expect(result.floorPlans?.receipt.skipped).toEqual([]);
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
    const after = await captureTables(database.db);
    const changes = compareTables(before, after);
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
    expect(
      result.floorPlans!.receipt.skipped.map(({ floorId }) => floorId).sort(),
    ).toEqual(
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
    const before = await captureTables(database.db);
    statements.length = 0;
    const repeated = await apply(receipt);
    expect(repeated.floorPlans?.applied).toBe(false);
    expect(repeated.floorPlans?.receipt.added).toEqual([]);
    expect(
      repeated.floorPlans?.receipt.skipped.every(
        ({ reason }) => reason === "existing_plan",
      ),
    ).toBe(true);
    expect(writes()).toEqual([]);
    expect(compareTables(before, await captureTables(database.db))).toEqual({
      ok: true,
      issues: [],
      added: [],
    });
  });
  it("also performs no writes without a receipt when every floor already has a plan", async () => {
    await apply();
    statements.length = 0;
    const result = await apply();
    expect(result.counts.floorPlans).toBe(0);
    expect(result.floorPlans!.receipt.skipped).toHaveLength(11);
    expect(writes()).toEqual([]);
  });
  it.each([
    "wrong floor parent",
    "missing author",
    "unverified author",
    "fixed ID collision",
    "foreign pointer",
  ])("rejects %s before changing data", async (kind) => {
    const first = plans[0]!;
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
    const before = await captureTables(database.db);
    statements.length = 0;
    await expect(apply()).rejects.toThrow(SeedError);
    expect(writes()).toEqual([]);
    expect(compareTables(before, await captureTables(database.db))).toEqual({
      ok: true,
      issues: [],
      added: [],
    });
  });
  it("rolls back all inserted plans and floor pointers after an intermediate failure", async () => {
    const insert = seedDal.putSeedPlan;
    let calls = 0;
    vi.spyOn(seedDal, "putSeedPlan").mockImplementation(async (...args) => {
      if (++calls === 3) throw new Error("fixture failure");
      return insert(...args);
    });
    const before = await captureTables(database.db);
    await expect(apply()).rejects.toThrow(SeedError);
    expect(compareTables(before, await captureTables(database.db))).toEqual({
      ok: true,
      issues: [],
      added: [],
    });
  });
  it("treats an earlier receipt as an audit record, not authority to repair or reject existing plans", async () => {
    const receipt = (await apply()).floorPlans!.receipt;
    receipt.manifestHash = "0".repeat(64);
    receipt.added.pop();
    receipt.added[0]!.createdBy = crypto.randomUUID();
    const before = await captureTables(database.db);
    statements.length = 0;
    expect((await apply(receipt)).counts.floorPlans).toBe(0);
    expect(writes()).toEqual([]);
    expect(compareTables(before, await captureTables(database.db))).toEqual({
      ok: true,
      issues: [],
      added: [],
    });
  });
  it("rejects a different database before changing data", async () => {
    statements.length = 0;
    await expect(
      apply(null, {
        floorPlans: {
          targetHash: hashFloorPlansValue(["fake.seed.test", "wrong-db"]),
          receipt: null,
          databaseName: "wrong-db",
        },
      }),
    ).rejects.toThrow(SeedError);
    expect(writes()).toEqual([]);
  });
  it.each([
    "missing floor",
    "missing space",
    "archived space",
    "extra active space",
  ])(
    "skips a %s with a reason and leaves that floor untouched",
    async (kind) => {
      const plan = plans.find(({ document }) => document.seats.length === 0)!;
      const space = data.spaces.find(
        ({ id }) => id === plan.document.spaces[0]!.spaceId,
      )!;
      if (kind === "missing floor") {
        await database.db
          .delete(spaces)
          .where(eq(spaces.floorId, plan.floorId));
        await database.db.delete(floors).where(eq(floors.id, plan.floorId));
      }
      if (kind === "missing space")
        await database.db.delete(spaces).where(eq(spaces.id, space.id));
      if (kind === "archived space")
        await database.db
          .update(spaces)
          .set({ archivedAt: now })
          .where(eq(spaces.id, space.id));
      if (kind === "extra active space")
        await database.db.insert(spaces).values({
          ...space,
          id: crypto.randomUUID(),
          name: "운영자가 추가한 공간",
        });
      const floorBefore = await database.db
        .select()
        .from(floors)
        .where(eq(floors.id, plan.floorId));
      const spacesBefore = await database.db
        .select()
        .from(spaces)
        .where(eq(spaces.floorId, plan.floorId));
      const result = await apply();
      expect(result.counts.floorPlans).toBe(10);
      expect(result.floorPlans!.receipt.skipped).toEqual([
        {
          floorId: plan.floorId,
          reason: kind === "missing floor" ? "missing_floor" : "changed_spaces",
        },
      ]);
      expect(
        await database.db
          .select()
          .from(floorPlans)
          .where(eq(floorPlans.floorId, plan.floorId)),
      ).toEqual([]);
      expect(
        await database.db
          .select()
          .from(floors)
          .where(eq(floors.id, plan.floorId)),
      ).toEqual(floorBefore);
      expect(
        await database.db
          .select()
          .from(spaces)
          .where(eq(spaces.floorId, plan.floorId)),
      ).toEqual(spacesBefore);
    },
  );
  it("skips both changed floors when a non-desk space moves", async () => {
    const source = plans.find(({ document }) => document.seats.length === 0)!;
    const target = plans.find(({ floorId }) => floorId !== source.floorId)!;
    await database.db
      .update(spaces)
      .set({ floorId: target.floorId })
      .where(eq(spaces.id, source.document.spaces[0]!.spaceId));
    const result = await apply();
    expect(result.counts.floorPlans).toBe(9);
    expect(result.floorPlans!.receipt.skipped).toEqual(
      [source.floorId, target.floorId]
        .sort()
        .map((floorId) => ({ floorId, reason: "changed_spaces" })),
    );
  });
  it("ignores extra archived spaces and changes to desk rows in the non-desk comparison", async () => {
    const space = data.spaces.find(({ type }) => type !== "desk")!;
    await database.db.insert(spaces).values({
      ...space,
      id: crypto.randomUUID(),
      name: "보관된 추가 공간",
      archivedAt: now,
    });
    await database.db
      .update(spaces)
      .set({ archivedAt: now })
      .where(eq(spaces.type, "desk"));
    expect((await apply()).counts.floorPlans).toBe(11);
  });
  it("adds a floor created after the first run without changing the earlier plans", async () => {
    const plan = plans.find(({ document }) => document.seats.length === 0)!;
    const floor = data.floors.find(({ id }) => id === plan.floorId)!;
    const floorSpaces = data.spaces.filter(
      ({ floorId }) => floorId === floor.id,
    );
    await database.db.delete(spaces).where(eq(spaces.floorId, floor.id));
    await database.db.delete(floors).where(eq(floors.id, floor.id));
    const first = (await apply()).floorPlans!.receipt;
    expect(first.added).toHaveLength(10);
    expect(first.skipped).toEqual([
      { floorId: floor.id, reason: "missing_floor" },
    ]);
    await database.db.insert(floors).values(floor);
    await database.db.insert(spaces).values(floorSpaces);
    const before = await database.db.select().from(floorPlans);
    statements.length = 0;
    const result = await apply(first);
    expect(result.counts.floorPlans).toBe(1);
    expect(result.floorPlans!.receipt.added).toEqual([
      { id: plan.id, floorId: floor.id, createdBy: admin },
    ]);
    const after = await database.db.select().from(floorPlans);
    expect(after.filter(({ id }) => id !== plan.id)).toEqual(before);
    expect(writes()).toHaveLength(2);
    statements.length = 0;
    expect((await apply(first)).counts.floorPlans).toBe(0);
    expect(writes()).toEqual([]);
  });
  it.each([
    { resetPasswords: true },
    { resetData: true },
    { branchIds: [data.branches[0]!.id] },
  ])(
    "rejects exclusive mode %j before opening a transaction",
    async (extra) => {
      const transaction = vi.spyOn(database.db, "transaction");
      await expect(apply(null, extra)).rejects.toThrow(SeedError);
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});
