import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBookingQueries } from "@/features/bookings/query-factory";
import { createChatQueries } from "@/features/chat/query-factory";
import { createSpaceActions } from "@/features/chat/space-action-factory";
import { listBranchCards } from "@/lib/dal/booking-discovery";
import { createBranchLounge } from "@/lib/dal/chat-write";
import { branches, chatSpaceMembers, chatSpaces } from "@/lib/db/schema";
import {
  bookingNow,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("branch lounge discovery", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  let spaceId: string;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.client.close();
  });
  beforeEach(async () => {
    actors = await seedBookingActors(database);
    ({ spaceId } = await createBranchLounge(actors.branchId, database.db));
  });
  const queries = (session = actors.person) =>
    createBookingQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => bookingNow,
    });
  const join = () =>
    createSpaceActions({
      database: database.db,
      getSession: async () => actors.person,
      now: () => bookingNow,
      publisher: { publish: async () => {}, publishMany: async () => {} },
    }).joinLounge({ branchId: actors.branchId });

  it("reports only the current user's active membership in the same card and header contract", async () => {
    expect(
      (await queries().getBranchList()).find(({ id }) => id === actors.branchId)
        ?.lounge,
    ).toEqual({ spaceId, joined: false });
    expect(
      (await queries().getBranchNavigation(actors.branchId)).lounge,
    ).toEqual({ spaceId, joined: false });
    expect(await join()).toEqual({ ok: true, data: { spaceId } });
    const navigation = await queries().getBranchNavigation(actors.branchId);
    expect(navigation.lounge).toEqual({ spaceId, joined: true });
    expect(
      navigation.branches.every(
        (branch) => Object.keys(branch).sort().join() === "id,name",
      ),
    ).toBe(true);
    expect(
      (await queries().getBranchList()).find(({ id }) => id === actors.branchId)
        ?.lounge,
    ).toEqual(navigation.lounge);
    expect(
      (await queries(actors.member).getBranchNavigation(actors.branchId)).lounge
        .joined,
    ).toBe(false);
    expect(
      (await queries(actors.operator).getBranchNavigation(actors.branchId))
        .lounge.joined,
    ).toBe(false);
  });

  it("does not call a banned membership joined or return another member's information", async () => {
    await join();
    await database.db
      .update(chatSpaceMembers)
      .set({ status: "banned", statusChangedAt: bookingNow });
    const data = await queries().getBranchNavigation(actors.branchId);
    expect(data.lounge).toEqual({ spaceId, joined: false });
    expect(Object.keys(data.lounge).sort()).toEqual(["joined", "spaceId"]);
  });

  it("returns a missing or deleted lounge as nullable metadata without changing branch discovery", async () => {
    expect(
      (await queries().getBranchNavigation(actors.otherBranchId)).lounge,
    ).toEqual({ spaceId: null, joined: false });
    await database.db
      .update(chatSpaces)
      .set({ deletedAt: bookingNow })
      .where(eq(chatSpaces.id, spaceId));
    expect(
      (await queries().getBranchList()).find(({ id }) => id === actors.branchId)
        ?.lounge,
    ).toEqual({ spaceId: null, joined: false });
  });

  it("makes both text channels available to the newly joined member for routing", async () => {
    expect(await join()).toEqual({ ok: true, data: { spaceId } });
    const nav = await createChatQueries({
      database: database.db,
      requireSession: async () => actors.person,
      now: () => bookingNow,
    }).getMyChatNav();
    const channels = nav.spaces.find(({ id }) => id === spaceId)!.channels;
    expect(channels.map(({ name }) => name).sort()).toEqual(["공지", "라운지"]);
  });

  it("keeps card, metadata and streaming budgets fixed with many lounges and memberships", async () => {
    const meter = createQueryMeter(database.client);
    async function measure() {
      const measurements = [];
      meter.start();
      await listBranchCards(actors.person.userId, database.db);
      measurements.push(meter.stop());
      meter.start();
      await queries().getBranchList();
      measurements.push(meter.stop());
      meter.start();
      const stream = await queries().getBranchNavigationStream(actors.branchId);
      await stream.bookingDates;
      measurements.push(meter.stop());
      return measurements;
    }
    try {
      const before = await measure();
      expect(before.map(({ perStage }) => perStage)).toEqual([
        [1],
        [6, 1],
        [6, 1],
      ]);
      const added = Array.from({ length: 12 }, (_, index) => ({
        id: crypto.randomUUID(),
        name: `가상 지점 ${index}`,
      }));
      await database.db.insert(branches).values(added);
      for (const branch of added) {
        const lounge = await createBranchLounge(branch.id, database.db);
        await database.db
          .insert(chatSpaceMembers)
          .values({
            spaceId: lounge.spaceId,
            userId: actors.person.userId,
            joinedAt: bookingNow,
            statusChangedAt: bookingNow,
          });
      }
      expect(await measure()).toEqual(before);
    } finally {
      meter.restore();
    }
  });
});
