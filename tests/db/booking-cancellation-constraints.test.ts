import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { bookings } from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import {
  bookingRange,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";

describe("48. cancellation kind and reason constraints in real migrations", () => {
  let database: TestDatabase;
  let fixture: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.client.close();
  });
  beforeEach(async () => {
    fixture = await seedBookingActors(database);
  });

  const insert = (value: Partial<typeof bookings.$inferInsert>) =>
    database.db.insert(bookings).values({
      spaceId: fixture.publicSpaceId,
      userId: fixture.person.userId,
      during: bookingRange(),
      status: "cancelled",
      cancelledAt: new Date("2026-10-07T00:00:00Z"),
      ...value,
    });
  it.each([
    {
      status: "confirmed" as const,
      cancelledAt: null,
      cancelKind: "operator" as const,
      cancelReason: "운영 사정",
    },
    { cancelKind: "operator" as const },
    { cancelKind: "maintenance" as const },
    { cancelReason: "운영 사정" },
  ])("rejects inconsistent cancellation %j", async (value) => {
    await expect(insert(value)).rejects.toMatchObject({
      cause: { code: "23514", constraint: "bookings_cancel_kind_consistent" },
    });
  });
  it.each(["", "가".repeat(201), "😀".repeat(201)])(
    "rejects invalid reason length %s",
    async (reason) => {
      await expect(
        insert({ cancelKind: "operator", cancelReason: reason }),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "bookings_cancel_reason_length" },
      });
    },
  );
  it.each([null, "operator", "maintenance"] as const)(
    "allows a complete or absent pair %s",
    async (kind) => {
      await expect(
        insert({
          cancelKind: kind,
          cancelReason: kind ? "😀".repeat(200) : null,
        }),
      ).resolves.toBeDefined();
    },
  );
});
