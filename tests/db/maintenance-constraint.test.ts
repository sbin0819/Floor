import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getPostgresError } from "@/lib/actions/errors";
import { spaceBlocks } from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import {
  bookingRange,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";

describe("constraint 49: maintenance ranges do not overlap on the same space", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    fixture = await seedBookingActors(database);
  });
  const add = (start: string, end: string, spaceId = fixture.publicSpaceId) =>
    database.db
      .insert(spaceBlocks)
      .values({
        spaceId,
        during: bookingRange(start, end),
        createdBy: fixture.operator.userId,
        reason: "점검",
      })
      .returning();
  it("rejects overlap with named 23P01 but permits touching and another space", async () => {
    await add("13:00", "14:00");
    try {
      await add("13:30", "14:30");
      expect.fail("overlap must fail");
    } catch (error) {
      expect(getPostgresError(error)).toEqual({
        code: "23P01",
        constraint: "space_blocks_no_overlap",
      });
    }
    await add("14:00", "15:00");
    await add("13:30", "14:30", fixture.secondSpaceId);
    expect(await database.db.select().from(spaceBlocks)).toHaveLength(3);
  });
  it("applies to changes too and preserves the original range on failure", async () => {
    await add("13:00", "14:00");
    const [second] = await add("15:00", "16:00");
    expect(second).toBeDefined();
    await expect(
      database.db
        .update(spaceBlocks)
        .set({ during: bookingRange("13:30", "16:00") })
        .where(eq(spaceBlocks.id, second!.id)),
    ).rejects.toMatchObject({
      cause: { code: "23P01", constraint: "space_blocks_no_overlap" },
    });
    const [unchanged] = await database.db
      .select()
      .from(spaceBlocks)
      .where(eq(spaceBlocks.id, second!.id));
    expect(unchanged?.during).toEqual(bookingRange("15:00", "16:00"));
  });
});
