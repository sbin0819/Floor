import { eq, sql } from "drizzle-orm";
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
import photoFile from "@/docs/spec/examples/seed-photos.json";
import { createAuth, type AuthInstance } from "@/lib/auth/auth";
import * as scheduleDal from "@/lib/dal/seed-schedule";
import { branches, floors, spacePhotos, spaces, users } from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import { loadSeedData } from "@/lib/seed/data";
import * as photoLoader from "@/lib/seed/photos";
import { runSeed } from "@/lib/seed/run-seed";
import { createTestDatabase, type TestDatabase } from "./helper";

const now = new Date("2026-10-07T03:00:00Z");
const data = loadSeedData();
describe("transactional photo seeding", () => {
  let database: TestDatabase;
  let auth: AuthInstance;
  beforeAll(async () => {
    database = await createTestDatabase();
    auth = createAuth({
      db: database.db,
      email: createMemoryEmailSender(),
      secret: "photo-seed-tests-secret-with-at-least-32-bytes",
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
  });
  const seed = () =>
    runSeed({ db: database.db, auth, now, resetPasswords: false });
  const photos = () =>
    database.db
      .select()
      .from(spacePhotos)
      .orderBy(spacePhotos.spaceId, spacePhotos.sortOrder);
  const covers = () =>
    database.db
      .select({
        id: branches.id,
        path: branches.coverPhotoPath,
        alt: branches.coverPhotoAlt,
      })
      .from(branches)
      .orderBy(branches.id);

  it("writes 65 ordered photos and five covers, retaining identical rows on rerun", async () => {
    expect((await seed()).counts).toMatchObject({
      spacePhotos: 65,
      branchCovers: 5,
    });
    const firstPhotos = await photos();
    const firstCovers = await covers();
    expect(firstPhotos).toHaveLength(65);
    expect(firstCovers).toHaveLength(5);
    expect(
      firstCovers.every(({ path, alt }) => path !== null && alt !== null),
    ).toBe(true);
    expect(new Set(firstPhotos.map(({ spaceId }) => spaceId)).size).toBe(45);
    for (const { spaceId } of photoFile.spacePhotos) {
      const group = firstPhotos.filter((photo) => photo.spaceId === spaceId);
      expect(group.map(({ sortOrder }) => sortOrder)).toEqual(
        group.map((_, index) => index),
      );
    }
    for (const space of data.spaces.filter(
      ({ name, type }) =>
        name === "리뷰룸" || name === "폰부스 S-1" || type === "desk",
    ))
      expect(firstPhotos.some(({ spaceId }) => spaceId === space.id)).toBe(
        false,
      );
    await seed();
    expect(await photos()).toEqual(firstPhotos);
    expect(await covers()).toEqual(firstCovers);
  });

  it("replaces changed photos, removes omitted seed groups/covers, and preserves non-seed photos/covers", async () => {
    await seed();
    const foreignBranchId = crypto.randomUUID();
    const foreignFloorId = crypto.randomUUID();
    const foreignSpaceId = crypto.randomUUID();
    await database.db.insert(branches).values({
      id: foreignBranchId,
      name: "시드 밖 지점",
      coverPhotoPath: "/seed/photos/foreign.webp",
      coverPhotoAlt: "기존 사진",
    });
    await database.db.insert(floors).values({
      id: foreignFloorId,
      branchId: foreignBranchId,
      level: 1,
      name: "1F",
    });
    await database.db.insert(spaces).values({
      id: foreignSpaceId,
      floorId: foreignFloorId,
      name: "시드 밖 공간",
      type: "meeting_room",
    });
    const [foreignPhoto] = await database.db
      .insert(spacePhotos)
      .values({
        spaceId: foreignSpaceId,
        path: "/seed/photos/foreign.webp",
        alt: "기존 공간 사진",
        sortOrder: 0,
      })
      .returning();
    const firstGroup = photoFile.spacePhotos[0]!;
    const updatedGroup = photoFile.spacePhotos[1]!;
    const changed = structuredClone(photoFile);
    changed.spacePhotos = changed.spacePhotos.filter(
      ({ spaceId }) => spaceId !== firstGroup.spaceId,
    );
    changed.spacePhotos[0]!.photos = [
      { path: "/seed/photos/replacement.webp", alt: "바뀐 대표 사진" },
    ];
    changed.branchCovers = changed.branchCovers.slice(1);
    vi.spyOn(photoLoader, "loadSeedPhotos").mockReturnValue(
      photoLoader.parseSeedPhotos(changed, data),
    );
    const result = await seed();
    expect(result.counts).toMatchObject({ spacePhotos: 61, branchCovers: 4 });
    const rows = await photos();
    expect(
      rows.filter(({ spaceId }) => spaceId === firstGroup.spaceId),
    ).toEqual([]);
    expect(
      rows.filter(({ spaceId }) => spaceId === updatedGroup.spaceId),
    ).toMatchObject([
      {
        path: "/seed/photos/replacement.webp",
        alt: "바뀐 대표 사진",
        sortOrder: 0,
      },
    ]);
    expect(rows.find(({ spaceId }) => spaceId === foreignSpaceId)).toEqual(
      foreignPhoto,
    );
    expect(
      (await covers()).find(
        ({ id }) => id === photoFile.branchCovers[0]!.branchId,
      ),
    ).toMatchObject({ path: null, alt: null });
    expect((await covers()).find(({ id }) => id === foreignBranchId)).toEqual({
      id: foreignBranchId,
      path: "/seed/photos/foreign.webp",
      alt: "기존 사진",
    });
  });

  it("removes stale photos from seed spaces absent from the photo source", async () => {
    await seed();
    const room = data.spaces.find(({ name }) => name === "리뷰룸")!;
    await database.db.insert(spacePhotos).values({
      spaceId: room.id,
      path: "/seed/photos/stale.webp",
      alt: "남은 사진",
      sortOrder: 0,
    });
    await seed();
    expect(
      (await photos()).filter(({ spaceId }) => spaceId === room.id),
    ).toEqual([]);
    expect(await photos()).toHaveLength(65);
  });

  it("clears all seed-owned photos and covers when the photo file is empty", async () => {
    await seed();
    vi.spyOn(photoLoader, "loadSeedPhotos").mockReturnValue({
      branchCovers: [],
      spacePhotos: [],
    });
    expect((await seed()).counts).toMatchObject({
      spacePhotos: 0,
      branchCovers: 0,
    });
    expect(await photos()).toEqual([]);
    expect(
      (await covers()).every(({ path, alt }) => path === null && alt === null),
    ).toBe(true);
  });

  it("rolls photo synchronization back with all original seed data after a later failure", async () => {
    await seed();
    const first = (await photos())[0]!;
    await database.db
      .update(spacePhotos)
      .set({ path: "/seed/photos/original.webp", alt: "이전 사진" })
      .where(eq(spacePhotos.id, first.id));
    const branch = data.branches[0]!;
    await database.db
      .update(branches)
      .set({
        name: "보존할 이름",
        coverPhotoPath: "/seed/photos/original-cover.webp",
        coverPhotoAlt: "이전 대표 사진",
      })
      .where(eq(branches.id, branch.id));
    const beforePhotos = await photos();
    const beforeBranches = await database.db
      .select()
      .from(branches)
      .orderBy(branches.id);
    const beforeUsers = await database.db
      .select()
      .from(users)
      .orderBy(users.id);
    vi.spyOn(scheduleDal, "insertSeedBookings").mockRejectedValueOnce(
      new Error("simulated late seed failure"),
    );
    await expect(seed()).rejects.toThrow("모든 시드 변경을 되돌렸어요.");
    expect(await photos()).toEqual(beforePhotos);
    expect(
      await database.db.select().from(branches).orderBy(branches.id),
    ).toEqual(beforeBranches);
    expect(await database.db.select().from(users).orderBy(users.id)).toEqual(
      beforeUsers,
    );
  });

  it("validates photo references before initializing auth or changing data", async () => {
    vi.spyOn(photoLoader, "loadSeedPhotos").mockImplementation(() =>
      photoLoader.parseSeedPhotos(
        {
          ...photoFile,
          branchCovers: [
            { ...photoFile.branchCovers[0]!, branchId: crypto.randomUUID() },
          ],
        },
        data,
      ),
    );
    await expect(seed()).rejects.toThrow("시드 데이터 검증 실패");
    expect(await database.db.select().from(users)).toEqual([]);
    expect(await database.db.select().from(branches)).toEqual([]);
    expect(await photos()).toEqual([]);
  });

  it("preserves an uploaded photo and its contents when the full seed restores its occupied slot", async () => {
    await seed();
    const target = photoFile.spacePhotos[0]!;
    const before = await photos();
    const replaced = before.find(
      (photo) => photo.spaceId === target.spaceId && photo.sortOrder === 0,
    )!;
    await database.db
      .delete(spacePhotos)
      .where(eq(spacePhotos.id, replaced.id));
    const id = crypto.randomUUID();
    const [uploaded] = await database.db
      .insert(spacePhotos)
      .values({
        id,
        spaceId: target.spaceId,
        path: `/api/space-photos/${id}.webp`,
        alt: "운영자가 올린 설명을 보존해요",
        sortOrder: 0,
      })
      .returning();
    expect((await seed()).counts).toMatchObject({
      spacePhotos: 65,
      branchCovers: 5,
    });
    const result = await photos();
    expect(result).toHaveLength(66);
    expect(result.find((photo) => photo.id === id)).toEqual({
      ...uploaded,
      sortOrder: target.photos.length,
    });
    expect(
      result.filter(
        (photo) =>
          photo.spaceId === target.spaceId && photo.path.startsWith("/seed/"),
      ),
    ).toMatchObject(
      target.photos.map((photo, sortOrder) => ({
        ...photo,
        spaceId: target.spaceId,
        sortOrder,
      })),
    );
    expect(result.filter((photo) => photo.spaceId !== target.spaceId)).toEqual(
      before.filter((photo) => photo.spaceId !== target.spaceId),
    );
    await seed();
    expect(await photos()).toEqual(result);
  });

  it("rolls back the entire full seed when preserved uploads plus restored seed photos exceed ten", async () => {
    await seed();
    const target = photoFile.spacePhotos.find(
      (group) => group.photos.length >= 3,
    )!;
    expect(target).toBeDefined();
    await database.db
      .delete(spacePhotos)
      .where(eq(spacePhotos.spaceId, target.spaceId));
    await database.db.insert(spacePhotos).values(
      Array.from({ length: 8 }, (_, sortOrder) => {
        const id = crypto.randomUUID();
        return {
          id,
          spaceId: target.spaceId,
          path: `/api/space-photos/${id}.webp`,
          alt: `업로드 사진 ${sortOrder}`,
          sortOrder,
        };
      }),
    );
    await database.db
      .update(branches)
      .set({ name: "실패하면 유지할 지점명" })
      .where(eq(branches.id, data.branches[0]!.id));
    const beforePhotos = await photos();
    const beforeBranches = await database.db
      .select()
      .from(branches)
      .orderBy(branches.id);
    const beforeUsers = await database.db
      .select()
      .from(users)
      .orderBy(users.id);
    await expect(seed()).rejects.toThrow(
      "시드 사진과 보존할 사진이 10장을 넘어요.",
    );
    expect(await photos()).toEqual(beforePhotos);
    expect(
      await database.db.select().from(branches).orderBy(branches.id),
    ).toEqual(beforeBranches);
    expect(await database.db.select().from(users).orderBy(users.id)).toEqual(
      beforeUsers,
    );
  });
});
