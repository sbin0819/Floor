import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createBookingQueries } from "@/features/bookings/query-factory";
import { createAuth } from "@/lib/auth/auth";
import * as spaceDal from "@/lib/dal/spaces";
import { branches, spaces, spacePhotos, users } from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import { loadSeedData } from "@/lib/seed/data";
import { runSeed } from "@/lib/seed/run-seed";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("photo DTO privacy and bounded reads", () => {
  let database: TestDatabase;
  const seed = loadSeedData();
  const now = new Date("2026-10-07T03:00:00Z");
  const branchId = seed.branches.find(({ name }) => name === "강남점")!.id;
  const floorId = seed.floors.find(
    (floor) => floor.branchId === branchId && floor.level === 7,
  )!.id;
  beforeAll(async () => {
    database = await createTestDatabase();
    const auth = createAuth({
      db: database.db,
      email: createMemoryEmailSender(),
      secret: "photo-query-test-secret-at-least-32-bytes",
      baseUrl: "http://localhost:3000",
      rateLimit: { enabled: false },
    });
    await runSeed({ db: database.db, auth, now, resetPasswords: false });
    await database.db
      .update(users)
      .set({ defaultBranchId: branchId })
      .where(eq(users.email, "member@floor.com"));
  });
  afterAll(async () => {
    await database?.client.close();
  });
  async function queries(email = "member@floor.com") {
    const [user] = await database.db
      .select()
      .from(users)
      .where(eq(users.email, email));
    if (!user) throw new Error("Missing photo fixture user");
    return createBookingQueries({
      database: database.db,
      now: () => now,
      requireSession: async () => ({
        userId: user.id,
        name: user.name,
        email: user.email,
      }),
    });
  }

  it("does not read or disclose restricted photo paths on floor, home or branch DTOs", async () => {
    const query = await queries();
    const read = vi.spyOn(spaceDal, "getSpacesByIds");
    try {
      const floor = await query.getFloorDay(branchId, floorId);
      const results = await Promise.all([
        query.getHomeFreeSpaces(),
        query.getHomeUpcomingBookings(),
        query.getHomeHeader(),
        query.getBranchList(),
      ]);
      expect(results[0].state).toBe("ready");
      const encoded = JSON.stringify([floor, ...results]);
      for (const sentinel of [
        "meeting-large-clay",
        "meeting-large-sand",
        "phone-booth-sage",
      ])
        expect(encoded).not.toContain(sentinel);
      const restricted = floor.spaces.filter(
        ({ kind }) => kind === "restricted",
      );
      expect(restricted.length).toBeGreaterThan(0);
      for (const space of restricted) {
        expect(Object.keys(space).sort()).toEqual(["id", "kind", "type"]);
        for (const [ids] of read.mock.calls)
          expect(ids).not.toContain(space.id);
      }
      expect(
        floor.spaces.some(
          (space) => space.kind === "accessible" && space.photo !== null,
        ),
      ).toBe(true);
    } finally {
      read.mockRestore();
    }
  });

  it("returns allowed cover and sorted detail photos without adding SQL", async () => {
    const query = await queries("both@floor.com");
    const floor = await query.getFloorDay(branchId, floorId);
    const room = floor.spaces.find(
      (space) => space.kind === "accessible" && space.name === "회의실 A",
    );
    expect(room?.kind).toBe("accessible");
    if (!room || room.kind !== "accessible")
      throw new Error("Missing allowed fixture");
    expect(room.photo?.path).toContain("meeting-large-clay");
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      const detail = await query.getSpaceDay(branchId, floorId, room.id);
      expect(meter.stop().perStage).toEqual([6, 6]);
      expect(detail.photos.length).toBeGreaterThan(1);
      expect(detail.photos[0]).toEqual(room.photo);
      for (const photo of detail.photos)
        expect(Object.keys(photo).sort()).toEqual(["alt", "path"]);
      meter.start();
      await query.getFloorDay(branchId, floorId);
      expect(meter.stop().perStage).toEqual([6, 4]);
    } finally {
      meter.restore();
    }
  });

  it("does not promote a nonzero-order photo when the cover is missing", async () => {
    const query = await queries();
    const room = seed.spaces.find(({ name }) => name === "회의실 B");
    if (!room) throw new Error("Missing public photo room");
    const photos = await database.db
      .select()
      .from(spacePhotos)
      .where(eq(spacePhotos.spaceId, room.id));
    const cover = photos.find(({ sortOrder }) => sortOrder === 0);
    if (!cover || photos.length < 2)
      throw new Error("Missing multiple-photo fixture");
    await database.db.delete(spacePhotos).where(eq(spacePhotos.id, cover.id));
    try {
      const floor = await query.getFloorDay(branchId, floorId);
      expect(floor.spaces.find(({ id }) => id === room.id)).toMatchObject({
        kind: "accessible",
        photo: null,
      });
      const detail = await query.getSpaceDay(branchId, floorId, room.id);
      expect(detail.space.photo).toBeNull();
      expect(detail.photos).toHaveLength(photos.length - 1);
      expect(detail.photos).not.toContainEqual({
        path: cover.path,
        alt: cover.alt,
      });
    } finally {
      await database.db.insert(spacePhotos).values(cover);
    }
  });

  it("keeps the own-booking photo exception after access is closed", async () => {
    const query = await queries();
    const before = await query.getMyBookings();
    const booking = before.upcoming.find(({ photo }) => photo !== null);
    expect(booking).toBeDefined();
    if (!booking) throw new Error("Missing own photo booking");
    const [previous] = await database.db
      .select()
      .from(spaces)
      .where(eq(spaces.id, booking.spaceId));
    if (!previous) throw new Error("Missing own booking space");
    await database.db
      .update(spaces)
      .set({ access: "closed" })
      .where(eq(spaces.id, booking.spaceId));
    try {
      expect(
        (await query.getMyBookings()).upcoming.find(
          ({ id }) => id === booking.id,
        )?.photo,
      ).toEqual(booking.photo);
      expect(
        (await query.getHomeUpcomingBookings()).bookings.find(
          ({ id }) => id === booking.id,
        )?.photo,
      ).toEqual(booking.photo);
      await expect(
        query.getSpaceDay(booking.branchId, booking.floorId, booking.spaceId),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await database.db
        .update(spaces)
        .set({ access: previous.access })
        .where(eq(spaces.id, booking.spaceId));
    }
  });

  it("returns branch covers and only accessible bookable counts", async () => {
    const query = await queries();
    const list = await query.getBranchList();
    for (const item of list) {
      const [branch] = await database.db
        .select()
        .from(branches)
        .where(eq(branches.id, item.id));
      if (!branch) throw new Error("Missing cover branch");
      expect(item.cover).toEqual({
        path: branch.coverPhotoPath,
        alt: branch.coverPhotoAlt,
      });
      expect(item.bookableSpaceCount).toBeGreaterThan(0);
    }
    expect((await query.getBranchNavigation(branchId)).branch.cover).toEqual(
      list.find(({ id }) => id === branchId)?.cover,
    );
    const member = await queries("design.member@floor.com");
    expect(
      (await member.getBranchList()).find(({ id }) => id === branchId)!
        .bookableSpaceCount,
    ).toBeGreaterThan(
      list.find(({ id }) => id === branchId)!.bookableSpaceCount,
    );
  });
});
