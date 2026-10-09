import { eq, sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { branches, floors, spacePhotos, spaces } from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("53. deferrable space photo ordering", () => {
  let database: TestDatabase;
  let spaceId: string;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`truncate branches cascade`);
    const [branch] = await database.db
      .insert(branches)
      .values({ name: "사진 지점" })
      .returning();
    const [floor] = await database.db
      .insert(floors)
      .values({ branchId: branch!.id, name: "7F", level: 7 })
      .returning();
    const [space] = await database.db
      .insert(spaces)
      .values({ floorId: floor!.id, name: "회의실", type: "meeting_room" })
      .returning();
    spaceId = space!.id;
  });
  const insert = async () =>
    database.db
      .insert(spacePhotos)
      .values(
        [0, 1, 2].map((sortOrder) => ({
          spaceId,
          sortOrder,
          path: `/seed/photos/photo-${sortOrder}.webp`,
          alt: `사진 ${sortOrder}`,
        })),
      )
      .returning();
  const rows = () =>
    database.db.select().from(spacePhotos).orderBy(spacePhotos.id);

  it("is initially immediate and has no competing immediate unique index", async () => {
    const result = await database.client.query<{
      condeferrable: boolean;
      condeferred: boolean;
      indimmediate: boolean;
    }>(`select c.condeferrable, c.condeferred, i.indimmediate
      from pg_constraint c join pg_index i on i.indexrelid = c.conindid
      where c.conrelid = 'public.space_photos'::regclass and c.conname = 'space_photos_space_order_unique'`);
    expect(result.rows).toEqual([
      { condeferrable: true, condeferred: false, indimmediate: false },
    ]);
    const indexes = await database.client.query<{
      count: number;
    }>(`select count(*)::int as count from pg_index
      where indrelid = 'public.space_photos'::regclass and indisunique and not indisprimary`);
    expect(indexes.rows).toEqual([{ count: 1 }]);
  });
  it("swaps two positions in one UPDATE without changing IDs or contents", async () => {
    await insert();
    const before = await rows();
    await database.db
      .update(spacePhotos)
      .set({
        sortOrder: sql`case when ${spacePhotos.sortOrder} = 0 then 1 when ${spacePhotos.sortOrder} = 1 then 0 else ${spacePhotos.sortOrder} end`,
      })
      .where(eq(spacePhotos.spaceId, spaceId));
    expect(await rows()).toEqual(
      before.map((row) => ({
        ...row,
        sortOrder: row.sortOrder < 2 ? 1 - row.sortOrder : row.sortOrder,
      })),
    );
  });
  it("accepts the single VALUES update used by reorder and preserves all three rows", async () => {
    const inserted = await insert();
    const values = sql.join(
      inserted.map(
        (row) => sql`(${row.id}::uuid, ${(row.sortOrder + 1) % 3}::integer)`,
      ),
      sql`, `,
    );
    await database.db
      .update(spacePhotos)
      .set({ sortOrder: sql`photo_order.sort_order` })
      .from(sql`(values ${values}) as photo_order(id, sort_order)`)
      .where(eq(spacePhotos.id, sql`photo_order.id`));
    expect(await rows()).toEqual(
      inserted
        .map((row) => ({ ...row, sortOrder: (row.sortOrder + 1) % 3 }))
        .sort((a, b) => a.id.localeCompare(b.id)),
    );
  });
  it("rejects the first conflicting statement rather than waiting for transaction commit", async () => {
    const inserted = await insert();
    const before = await rows();
    let secondReached = false;
    await expect(
      database.db.transaction(async (tx) => {
        await tx
          .update(spacePhotos)
          .set({ sortOrder: 1 })
          .where(eq(spacePhotos.id, inserted[0]!.id));
        secondReached = true;
        await tx
          .update(spacePhotos)
          .set({ sortOrder: 0 })
          .where(eq(spacePhotos.id, inserted[1]!.id));
      }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "space_photos_space_order_unique" },
    });
    expect(secondReached).toBe(false);
    expect(await rows()).toEqual(before);
  });
  it("still rejects a final duplicate assignment at the end of a single UPDATE", async () => {
    await insert();
    const before = await rows();
    await expect(
      database.db
        .update(spacePhotos)
        .set({ sortOrder: 0 })
        .where(eq(spacePhotos.spaceId, spaceId)),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "space_photos_space_order_unique" },
    });
    expect(await rows()).toEqual(before);
  });
  it("accepts an uploaded API path without changing the existing path constraint", async () => {
    const id = crypto.randomUUID();
    await database.db.insert(spacePhotos).values({
      id,
      spaceId,
      sortOrder: 0,
      path: `/api/space-photos/${id}.webp`,
      alt: "올린 사진",
    });
    expect((await rows())[0]).toMatchObject({
      id,
      path: `/api/space-photos/${id}.webp`,
    });
  });
  it("upgrades the old named constraint without modifying any stored photo", async () => {
    await insert();
    const before = await rows();
    const migration = readMigrationFiles({
      migrationsFolder: "./drizzle",
    }).find(({ sql }) =>
      sql.some(
        (statement) =>
          statement.includes(
            'ADD CONSTRAINT "space_photos_space_order_unique"',
          ) && statement.includes("DEFERRABLE INITIALLY IMMEDIATE"),
      ),
    )!;
    expect(migration).toBeDefined();
    await database.db.transaction(async (tx) => {
      await tx.execute(
        sql`alter table public.space_photos drop constraint space_photos_space_order_unique`,
      );
      await tx.execute(
        sql`alter table public.space_photos add constraint space_photos_space_order_unique unique (space_id, sort_order) not deferrable`,
      );
      for (const statement of migration.sql)
        await tx.execute(sql.raw(statement));
    });
    expect(await rows()).toEqual(before);
  });
});
