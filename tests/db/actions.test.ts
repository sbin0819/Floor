import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createAction } from "@/lib/actions/create-action";
import { getActionErrorCode } from "@/lib/actions/errors";
import { bookings, branches, floors, spaces, users } from "@/lib/db/schema";

import { createTestDatabase, type TestDatabase } from "./helper";

describe("real PostgreSQL errors in the action wrapper", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database?.client.close();
  });

  it("maps an actual Drizzle-wrapped exclusion violation to BOOKING_CONFLICT", async () => {
    const userId = crypto.randomUUID();
    const branchId = crypto.randomUUID();
    const floorId = crypto.randomUUID();
    const spaceId = crypto.randomUUID();
    const during = {
      start: new Date("2026-10-07T10:00:00Z"),
      end: new Date("2026-10-07T11:00:00Z"),
    };
    await database.db
      .insert(users)
      .values({ id: userId, name: "가상 멤버", email: "member@example.test" });
    await database.db
      .insert(branches)
      .values({ id: branchId, name: "가상 지점" });
    await database.db
      .insert(floors)
      .values({ id: floorId, branchId, level: 7, name: "7F" });
    await database.db
      .insert(spaces)
      .values({ id: spaceId, floorId, name: "회의실", type: "meeting_room" });
    await database.db.insert(bookings).values({ spaceId, userId, during });

    let actualError: unknown;
    const logError = vi.fn();
    const action = createAction(
      {
        input: z.object({ spaceId: z.uuid() }),
        authorize: "none",
        handler: async ({ input, session }) => {
          try {
            await database.db.insert(bookings).values({
              spaceId: input.spaceId,
              userId: session.userId,
              during,
            });
          } catch (error) {
            actualError = error;
            throw error;
          }
          return null;
        },
      },
      {
        getSession: async () => ({
          userId,
          name: "가상 멤버",
          email: "member@example.test",
        }),
        logError,
      },
    );

    await expect(action({ spaceId })).resolves.toEqual({
      ok: false,
      code: "BOOKING_CONFLICT",
    });
    expect(actualError).not.toHaveProperty("code");
    expect(actualError).toMatchObject({
      cause: { code: "23P01", constraint: "bookings_no_overlap" },
    });
    expect(getActionErrorCode(actualError)).toBe("BOOKING_CONFLICT");
    expect(logError).not.toHaveBeenCalled();
    expect(await database.db.select().from(bookings)).toHaveLength(1);
  });
});
