import { and, eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createInviteManagementActions } from "@/features/teams/invite-management-factory";
import { createJoinRequestActions } from "@/features/teams/join-request-factory";
import { createCancelBookingAction } from "@/features/bookings/cancel-booking-factory";
import { replaceAccessGrants } from "@/lib/dal/admin";
import type { DalDatabase, TransactionDatabase } from "@/lib/dal/database";
import {
  accessGrants,
  bookings,
  teamInvites,
  teamJoinRequests,
  teamMembers,
  teams,
} from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import { createTestDatabase, type TestDatabase } from "./helper";
import { seedTeam, seedTeamActors, type TeamActors } from "./team-helper";
import {
  bookingNow,
  insertFixtureBooking,
  seedBookingActors,
} from "./booking-helper";

function betweenAuthorizationAndTransaction(
  database: TestDatabase,
  before: () => Promise<void>,
): DalDatabase & TransactionDatabase {
  return {
    select: database.db.select.bind(database.db),
    insert: database.db.insert.bind(database.db),
    update: database.db.update.bind(database.db),
    delete: database.db.delete.bind(database.db),
    transaction: async (callback) => {
      await before();
      return database.db.transaction(callback);
    },
  };
}

describe("existing team writes recheck authority after locks", () => {
  let database: TestDatabase;
  let actors: TeamActors;
  let teamId: string;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    actors = await seedTeamActors(database);
    teamId = (await seedTeam(database, actors.owner)).id;
    await database.db
      .insert(teamMembers)
      .values({ teamId, userId: actors.otherOwner.userId, role: "admin" });
  });
  const demote = async () => {
    await database.db
      .update(teamMembers)
      .set({ role: "member" })
      .where(
        and(
          eq(teamMembers.teamId, teamId),
          eq(teamMembers.userId, actors.owner.userId),
        ),
      );
  };
  it.each(["approveTeamJoinRequest", "rejectTeamJoinRequest"] as const)(
    "rejects a now-demoted administrator at %s without deciding the request",
    async (method) => {
      const [request] = await database.db
        .insert(teamJoinRequests)
        .values({ teamId, userId: actors.outsider.userId })
        .returning();
      const actions = createJoinRequestActions({
        database: betweenAuthorizationAndTransaction(database, demote),
        getSession: async () => actors.owner,
      });
      expect(await actions[method]({ requestId: request!.id })).toEqual({
        ok: false,
        code: "FORBIDDEN",
      });
      const [after] = await database.db
        .select()
        .from(teamJoinRequests)
        .where(eq(teamJoinRequests.id, request!.id));
      expect(after).toMatchObject({
        status: "pending",
        decidedBy: null,
        decidedAt: null,
      });
    },
  );
  it.each(["sendTeamInvite", "revokeTeamInvite"] as const)(
    "rejects a now-demoted administrator at %s without email or invite writes",
    async (method) => {
      const [invite] = await database.db
        .insert(teamInvites)
        .values({
          teamId,
          token: "old-pending",
          createdBy: actors.owner.userId,
          email: actors.outsider.email,
        })
        .returning();
      const email = createMemoryEmailSender();
      const send = vi.spyOn(email, "send");
      const actions = createInviteManagementActions({
        database: betweenAuthorizationAndTransaction(database, demote),
        getSession: async () => actors.owner,
        email,
        appUrl: "http://localhost:3000",
      });
      const input =
        method === "sendTeamInvite"
          ? { teamId, email: actors.outsider.email }
          : { inviteId: invite!.id };
      expect(await actions[method](input)).toEqual({
        ok: false,
        code: "FORBIDDEN",
      });
      expect(send).not.toHaveBeenCalled();
      expect(await database.db.select().from(teamInvites)).toEqual([invite]);
    },
  );
  it("does not let a demoted manager cancel an existing team booking", async () => {
    const fixture = await seedBookingActors(database);
    await database.db
      .insert(teamMembers)
      .values({
        teamId: fixture.teamId,
        userId: fixture.person.userId,
        role: "admin",
      });
    const booking = await insertFixtureBooking(database, fixture, {
      userId: fixture.member.userId,
      teamId: fixture.teamId,
    });
    const db = betweenAuthorizationAndTransaction(database, async () => {
      await database.db
        .update(teamMembers)
        .set({ role: "member" })
        .where(
          and(
            eq(teamMembers.teamId, fixture.teamId),
            eq(teamMembers.userId, fixture.admin.userId),
          ),
        );
    });
    const cancel = createCancelBookingAction({
      database: db,
      getSession: async () => fixture.admin,
      now: () => bookingNow,
    });
    expect(await cancel({ bookingId: booking.id })).toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(await database.db.select().from(bookings)).toEqual([booking]);
  });
  it("rejects deleted teams before replacing any allowed teams and rolls back", async () => {
    const fixture = await seedBookingActors(database);
    await database.db
      .update(teams)
      .set({ deletedAt: bookingNow, deletedBy: fixture.admin.userId })
      .where(eq(teams.id, fixture.otherTeamId));
    const before = await database.db.select().from(accessGrants);
    await expect(
      database.db.transaction((tx) =>
        replaceAccessGrants(
          {
            targetType: "floor",
            targetId: fixture.restrictedFloorId,
            teamIds: [fixture.otherTeamId],
          },
          tx,
        ),
      ),
    ).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(await database.db.select().from(accessGrants)).toEqual(before);
  });
});
