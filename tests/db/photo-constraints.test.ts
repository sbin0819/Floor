import { eq, sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listSpaceCoverPhotos, listSpacePhotos } from "@/lib/dal/photos";
import { branches, floors, spacePhotos, spaces } from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

const path = "/seed/photos/a-1.webp";
const alt = "회의실 테이블과 화이트보드";
const invalidPaths = [
  "https://example.com/a.webp",
  "//example.com/a.webp",
  "/a/../b.webp",
  "seed/a.webp",
  "/a.gif",
  "/A.webp",
  "/seed/photos/awebp",
  "/seed/photos/a_png",
  "/seed//photos/a.webp",
  "/seed/photos/a.webp\n",
];

describe("photo constraints and reads from real migrations", () => {
  let database: TestDatabase;
  let branchId: string;
  let floorId: string;
  let spaceId: string;

  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`TRUNCATE TABLE branches CASCADE`);
    branchId = crypto.randomUUID();
    floorId = crypto.randomUUID();
    spaceId = crypto.randomUUID();
    await database.db
      .insert(branches)
      .values({ id: branchId, name: "사진 지점" });
    await database.db
      .insert(floors)
      .values({ id: floorId, branchId, level: 7, name: "7F" });
    await database.db
      .insert(spaces)
      .values({
        id: spaceId,
        floorId,
        name: "사진 회의실",
        type: "meeting_room",
      });
  });

  const insertPhoto = (values: Partial<typeof spacePhotos.$inferInsert> = {}) =>
    database.db
      .insert(spacePhotos)
      .values({ spaceId, path, alt, sortOrder: 0, ...values });

  it("18. rejects duplicate order within one space", async () => {
    await insertPhoto();
    await expect(
      insertPhoto({ path: "/seed/photos/b.webp" }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "space_photos_space_order_unique" },
    });
  });

  it.each([-1, 10])("18. rejects sort order %s", async (sortOrder) => {
    await expect(insertPhoto({ sortOrder })).rejects.toMatchObject({
      cause: { code: "23514", constraint: "space_photos_sort_order_range" },
    });
  });

  it("18. accepts all ten positions and permits the same order for another space", async () => {
    await database.db
      .insert(spacePhotos)
      .values(
        Array.from({ length: 10 }, (_, sortOrder) => ({
          spaceId,
          path,
          alt,
          sortOrder,
        })),
      );
    const otherId = crypto.randomUUID();
    await database.db
      .insert(spaces)
      .values({
        id: otherId,
        floorId,
        name: "다른 회의실",
        type: "meeting_room",
      });
    await insertPhoto({ spaceId: otherId });
    expect(await database.db.select().from(spacePhotos)).toHaveLength(11);
  });

  it("18. deletes a space's photos on cascade", async () => {
    await insertPhoto();
    await database.db.delete(spaces).where(eq(spaces.id, spaceId));
    expect(await database.db.select().from(spacePhotos)).toHaveLength(0);
  });

  it("18. rejects a photo that refers to a missing space", async () => {
    await expect(
      insertPhoto({ spaceId: crypto.randomUUID() }),
    ).rejects.toMatchObject({
      cause: {
        code: "23503",
        constraint: "space_photos_space_id_spaces_id_fk",
      },
    });
  });

  it.each(invalidPaths)("19. rejects photo path %s", async (path) => {
    await expect(insertPhoto({ path })).rejects.toMatchObject({
      cause: { code: "23514", constraint: "space_photos_path_format" },
    });
  });

  it.each([path, "/seed/photos/a-1.png", "/seed/photos/a-1.jpg"])(
    "19. accepts valid local path %s",
    async (path) => {
      await expect(insertPhoto({ path })).resolves.toBeDefined();
    },
  );

  it.each(["", "가".repeat(121), "🪑".repeat(121)])(
    "19. rejects an empty or overlong alt text",
    async (alt) => {
      await expect(insertPhoto({ alt })).rejects.toMatchObject({
        cause: { code: "23514", constraint: "space_photos_alt_length" },
      });
    },
  );

  it.each(["가".repeat(120), "🪑".repeat(120)])(
    "19. accepts a 120-character alt text",
    async (alt) => {
      await expect(insertPhoto({ alt })).resolves.toBeDefined();
    },
  );

  it("19. preserves the literal extension separator in generated SQL", () => {
    const statements = readMigrationFiles({
      migrationsFolder: "./drizzle",
    }).flatMap(({ sql }) => sql);
    const photoCheck = statements.find((statement) =>
      statement.includes('CONSTRAINT "space_photos_path_format"'),
    );
    const coverCheck = statements.find((statement) =>
      statement.includes('CONSTRAINT "branches_cover_photo_path_format"'),
    );
    expect(photoCheck).toContain("^/[a-z0-9/_-]+\\.(webp|png|jpg)$");
    expect(coverCheck).toContain("^/[a-z0-9/_-]+\\.(webp|png|jpg)$");
  });

  it.each([
    { coverPhotoPath: path, coverPhotoAlt: null },
    { coverPhotoPath: null, coverPhotoAlt: alt },
  ])(
    "20. rejects a branch cover with an unmatched path/alt pair",
    async (cover) => {
      await expect(
        database.db
          .update(branches)
          .set(cover)
          .where(eq(branches.id, branchId)),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "branches_cover_photo_pair" },
      });
    },
  );

  it.each(invalidPaths)(
    "20. rejects branch cover path %s",
    async (coverPhotoPath) => {
      await expect(
        database.db
          .update(branches)
          .set({ coverPhotoPath, coverPhotoAlt: alt })
          .where(eq(branches.id, branchId)),
      ).rejects.toMatchObject({
        cause: {
          code: "23514",
          constraint: "branches_cover_photo_path_format",
        },
      });
    },
  );

  it.each(["", "가".repeat(121)])(
    "20. rejects an empty or overlong branch cover alt text",
    async (coverPhotoAlt) => {
      await expect(
        database.db
          .update(branches)
          .set({ coverPhotoPath: path, coverPhotoAlt })
          .where(eq(branches.id, branchId)),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "branches_cover_photo_alt_length" },
      });
    },
  );

  it("20. supports no cover and a complete cover without changing existing branch fields", async () => {
    const [initial] = await database.db
      .select()
      .from(branches)
      .where(eq(branches.id, branchId));
    expect(initial).toMatchObject({
      name: "사진 지점",
      coverPhotoPath: null,
      coverPhotoAlt: null,
    });
    await database.db
      .update(branches)
      .set({ coverPhotoPath: path, coverPhotoAlt: alt })
      .where(eq(branches.id, branchId));
    const [withCover] = await database.db
      .select()
      .from(branches)
      .where(eq(branches.id, branchId));
    expect(withCover).toEqual({
      ...initial,
      coverPhotoPath: path,
      coverPhotoAlt: alt,
    });
    await database.db
      .update(branches)
      .set({ coverPhotoPath: null, coverPhotoAlt: null })
      .where(eq(branches.id, branchId));
    expect((await database.db.select().from(branches))[0]).toEqual(initial);
  });

  it("reads exactly one cover per requested space in one statement", async () => {
    const extra = Array.from({ length: 12 }, (_, index) => ({
      id: crypto.randomUUID(),
      floorId,
      name: `사진 회의실 ${index}`,
      type: "meeting_room" as const,
    }));
    await database.db.insert(spaces).values(extra);
    await database.db.insert(spacePhotos).values(
      extra.flatMap(({ id }, index) => [
        { spaceId: id, path, alt: `공간 ${index} 대표`, sortOrder: 0 },
        {
          spaceId: id,
          path: "/seed/photos/b.webp",
          alt: `공간 ${index} 두 번째`,
          sortOrder: 1,
        },
      ]),
    );
    await insertPhoto();
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const result = await listSpaceCoverPhotos(
        extra.map(({ id }) => id),
        database.db,
      );
      expect(meter.stop()).toEqual({ stages: 1, statements: 1, perStage: [1] });
      expect(result).toHaveLength(12);
      expect(result.map(({ spaceId }) => spaceId).sort()).toEqual(
        extra.map(({ id }) => id).sort(),
      );
      expect(
        result.every(
          (photo) => photo.path === path && Object.keys(photo).length === 3,
        ),
      ).toBe(true);
    } finally {
      meter.restore();
    }
  });

  it("reads all photos in order without exposing database-only fields", async () => {
    await insertPhoto({
      path: "/seed/photos/last.webp",
      alt: "세 번째",
      sortOrder: 2,
    });
    await insertPhoto({
      path: "/seed/photos/first.webp",
      alt: "첫 번째",
      sortOrder: 0,
    });
    await insertPhoto({
      path: "/seed/photos/middle.webp",
      alt: "두 번째",
      sortOrder: 1,
    });
    expect(await listSpacePhotos(spaceId, database.db)).toEqual([
      { path: "/seed/photos/first.webp", alt: "첫 번째" },
      { path: "/seed/photos/middle.webp", alt: "두 번째" },
      { path: "/seed/photos/last.webp", alt: "세 번째" },
    ]);
    expect(await listSpacePhotos(crypto.randomUUID(), database.db)).toEqual([]);
  });

  it("skips database initialization and queries for an empty cover request", async () => {
    expect(await listSpaceCoverPhotos([])).toEqual([]);
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      expect(await listSpaceCoverPhotos([], database.db)).toEqual([]);
      expect(meter.stop()).toEqual({ stages: 0, statements: 0, perStage: [] });
    } finally {
      meter.restore();
    }
  });
});
