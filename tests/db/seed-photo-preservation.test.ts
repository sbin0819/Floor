import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { syncSeedSpacePhotos } from "@/lib/dal/seed-photos";
import * as schema from "@/lib/db/schema";
import { branches, floors, spacePhotos, spaces } from "@/lib/db/schema";
import { SeedError } from "@/lib/seed/errors";
import type { SeedPhotoData } from "@/lib/seed/photos";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("photo seed preservation under deferrable ordering", () => {
  let database: TestDatabase;
  let db: TestDatabase["db"];
  let branchId: string;
  let ids: string[];
  const statements: string[] = [];
  beforeAll(async () => {
    database = await createTestDatabase();
    db = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(query) {
          statements.push(query);
        },
      },
    });
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    await db.execute(sql`truncate branches cascade`);
    const [branch] = await db
      .insert(branches)
      .values({ name: "사진 시드 지점" })
      .returning();
    branchId = branch!.id;
    const [floor] = await db
      .insert(floors)
      .values({ branchId, name: "7F", level: 7 })
      .returning();
    ids = (
      await db
        .insert(spaces)
        .values(
          ["첫 방", "둘째 방", "시드 밖 방"].map((name) => ({
            floorId: floor!.id,
            name,
            type: "meeting_room" as const,
          })),
        )
        .returning()
    ).map(({ id }) => id);
    statements.length = 0;
  });
  const seeds = (count = 2, spaceId = ids[0]!): SeedPhotoData["spacePhotos"] =>
    Array.from({ length: count }, (_, sortOrder) => ({
      spaceId,
      sortOrder,
      path: `/seed/photos/room-${sortOrder}.webp`,
      alt: `시드 사진 ${sortOrder}`,
    }));
  const uploads = async (orders: number[], spaceId = ids[0]!) =>
    db
      .insert(spacePhotos)
      .values(
        orders.map((sortOrder) => {
          const id = crypto.randomUUID();
          return {
            id,
            spaceId,
            sortOrder,
            path: `/api/space-photos/${id}.webp`,
            alt: `운영자가 쓴 설명 ${sortOrder}`,
          };
        }),
      )
      .returning();
  const read = () =>
    db
      .select()
      .from(spacePhotos)
      .orderBy(spacePhotos.spaceId, spacePhotos.sortOrder);
  const sync = (photos = seeds(), scope = ids.slice(0, 2)) =>
    db.transaction((tx) => syncSeedSpacePhotos(scope, photos, tx));

  it("reuses existing seed IDs by space and slot on unchanged and edited reruns", async () => {
    await sync();
    const before = await read();
    await sync();
    expect(await read()).toEqual(before);
    const changed = seeds().map((photo) => ({
      ...photo,
      path: photo.path.replace("room", "new"),
      alt: "새 시드 설명",
    }));
    await sync(changed);
    expect(await read()).toEqual(
      before.map((row) => ({
        ...row,
        path: row.path.replace("room", "new"),
        alt: "새 시드 설명",
      })),
    );
  });
  it("shifts conflicting uploads once while preserving IDs, paths, alt texts and relative order", async () => {
    const kept = await uploads([0, 1, 2]);
    statements.length = 0;
    await sync();
    const result = await read();
    expect(result.filter(({ path }) => path.startsWith("/api/"))).toEqual(
      kept.map((photo, index) => ({ ...photo, sortOrder: index + 2 })),
    );
    expect(
      result.filter(({ path }) => path.startsWith("/seed/")),
    ).toMatchObject(seeds());
    expect(
      statements.filter((query) => query.startsWith('update "space_photos"')),
    ).toHaveLength(1);
    expect(
      statements.find((query) => query.startsWith('update "space_photos"')),
    ).toContain("from (values");
    expect(statements.join("\n")).not.toMatch(/on conflict/i);
    const first = await read();
    await sync();
    expect(await read()).toEqual(first);
  });
  it("does not move nonconflicting upload positions or compact deliberate gaps", async () => {
    const kept = await uploads([0, 8, 9]);
    await sync();
    expect(
      (await read()).filter(({ path }) => path.startsWith("/api/")),
    ).toEqual(
      kept.map((photo, index) => ({
        ...photo,
        sortOrder: index === 0 ? 2 : photo.sortOrder,
      })),
    );
  });
  it("deletes only /seed/ rows in scope, leaving other paths and foreign-space rows intact", async () => {
    await sync();
    const upload = await uploads([4]);
    const otherPath = (
      await db
        .insert(spacePhotos)
        .values({
          spaceId: ids[0]!,
          sortOrder: 5,
          path: "/seeded/keep.webp",
          alt: "보존할 사진",
        })
        .returning()
    )[0]!;
    const foreign = await db
      .insert(spacePhotos)
      .values(seeds(1, ids[2]!))
      .returning();
    await sync([]);
    expect(await read()).toEqual(
      [...upload, otherPath, ...foreign].sort(
        (a, b) =>
          a.spaceId.localeCompare(b.spaceId) || a.sortOrder - b.sortOrder,
      ),
    );
  });
  it("preserves uploads in a scoped space omitted from the new seed source", async () => {
    const kept = await uploads([0, 1], ids[1]!);
    await db
      .insert(spacePhotos)
      .values(seeds(1, ids[1]!).map((photo) => ({ ...photo, sortOrder: 2 })));
    await sync();
    expect((await read()).filter(({ spaceId }) => spaceId === ids[1])).toEqual(
      kept,
    );
  });
  it("accepts exactly ten photos, retaining all eight uploads", async () => {
    const kept = await uploads([0, 1, 2, 3, 4, 5, 6, 7]);
    await sync();
    expect(await read()).toHaveLength(10);
    expect(
      (await read()).filter(({ path }) => path.startsWith("/api/")),
    ).toEqual(kept.map((row) => ({ ...row, sortOrder: row.sortOrder + 2 })));
  });
  it("fails before photo writes and rolls back earlier transaction changes if any space exceeds ten", async () => {
    await uploads([0, 1, 2, 3, 4, 5, 6, 7], ids[1]!);
    await db.insert(spacePhotos).values(seeds(1));
    const before = await read();
    const beforeBranches = await db.select().from(branches);
    statements.length = 0;
    await expect(
      db.transaction(async (tx) => {
        await tx
          .update(branches)
          .set({ name: "되돌릴 변경" })
          .where(eq(branches.id, branchId));
        await syncSeedSpacePhotos(
          ids.slice(0, 2),
          [...seeds(2), ...seeds(3, ids[1]!)],
          tx,
        );
      }),
    ).rejects.toBeInstanceOf(SeedError);
    expect(await read()).toEqual(before);
    expect(await db.select().from(branches)).toEqual(beforeBranches);
    expect(
      statements.filter((query) =>
        /^(insert into|update|delete from) "space_photos"/.test(query),
      ),
    ).toEqual([]);
  });
  it("rolls back shifted uploads and replaced seed rows after a later failure", async () => {
    await db.insert(spacePhotos).values(seeds(1));
    await uploads([1, 2]);
    const before = await read();
    await expect(
      db.transaction(async (tx) => {
        await syncSeedSpacePhotos(ids.slice(0, 2), seeds(3), tx);
        throw new Error("late fixture failure");
      }),
    ).rejects.toThrow("late fixture failure");
    expect(await read()).toEqual(before);
  });
  it("locks the affected spaces in UUID order before reading photos", async () => {
    await sync(seeds(), ids.slice(0, 2).reverse());
    const locks = statements.filter((query) => query.includes("for update"));
    expect(locks).toHaveLength(1);
    expect(locks[0]).toMatch(
      /from "spaces".*order by "spaces"\."id" for update/,
    );
    expect(statements.indexOf(locks[0]!)).toBeLessThan(
      statements.findIndex((query) => query.includes('from "space_photos"')),
    );
  });
  it("does nothing for an empty seed scope", async () => {
    await syncSeedSpacePhotos([], [], db);
    expect(statements).toEqual([]);
  });
});
