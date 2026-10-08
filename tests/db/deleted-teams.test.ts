import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createInviteResponseActions } from "@/features/teams/invite-response-factory";
import {
  getBookingWithLocation,
  listMyConfirmedBookingsBetween,
  listSpaceBookings,
  listUserTeamHomeBranches,
} from "@/lib/dal/bookings";
import {
  listMyTeamSummaries,
  listTeamHubRequests,
} from "@/lib/dal/team-screens";
import { acceptTeamInvite, createJoinRequest } from "@/lib/dal/teams-write";
import {
  bookings,
  floors,
  spaces,
  teams,
  teamInvites,
  teamJoinRequests,
} from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";
import { seedTeam, seedTeamActors, type TeamActors } from "./team-helper";

describe("deleted team historical labels and live entry boundaries", () => {
  let database: TestDatabase;
  let actors: TeamActors;
  let teamId: string;
  let spaceId: string;
  let bookingId: string;
  const during = {
    start: new Date("2026-10-01T01:00:00Z"),
    end: new Date("2026-10-01T02:00:00Z"),
  };
  const token = "a".repeat(43);
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    actors = await seedTeamActors(database);
    const team = await seedTeam(database, actors.owner);
    teamId = team.id;
    const [floor] = await database.db
      .insert(floors)
      .values({ branchId: actors.branchId, level: 1, name: "1F" })
      .returning();
    const [space] = await database.db
      .insert(spaces)
      .values({ floorId: floor!.id, name: "가상 회의실", type: "meeting_room" })
      .returning();
    spaceId = space!.id;
    const [booking] = await database.db
      .insert(bookings)
      .values({ spaceId, userId: actors.owner.userId, teamId, during })
      .returning();
    bookingId = booking!.id;
    await database.db
      .insert(teamInvites)
      .values({
        teamId,
        email: actors.outsider.email,
        token,
        createdBy: actors.owner.userId,
        expiresAt: new Date("2099-01-01T00:00:00Z"),
      });
    await database.db
      .insert(teamJoinRequests)
      .values({ teamId, userId: actors.member.userId });
    await database.db
      .update(teams)
      .set({
        deletedAt: new Date("2026-10-09T00:00:00Z"),
        deletedBy: actors.owner.userId,
        homeBranchId: actors.branchId,
      })
      .where(eq(teams.id, teamId));
  });

  it("keeps historical reservations but replaces the deleted name in every booking projection", async () => {
    expect(
      (await getBookingWithLocation(bookingId, database.db))?.teamName,
    ).toBe("지운 팀");
    expect(
      (await listSpaceBookings({ spaceIds: [spaceId], during }, database.db))[0]
        ?.teamName,
    ).toBe("지운 팀");
    expect(
      (
        await listMyConfirmedBookingsBetween(
          { userId: actors.owner.userId, ...during },
          database.db,
        )
      )[0]?.teamName,
    ).toBe("지운 팀");
    expect(
      await database.db
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId)),
    ).toHaveLength(1);
  });
  it("excludes a deleted team from home choices and hub rows even if cleanup has not run", async () => {
    expect(
      await listUserTeamHomeBranches(actors.owner.userId, database.db),
    ).toEqual([]);
    expect(await listMyTeamSummaries(actors.owner.userId, database.db)).toEqual(
      [],
    );
    expect(
      await listTeamHubRequests(
        actors.member.userId,
        new Date("2026-10-09T00:00:00Z"),
        database.db,
      ),
    ).toEqual([]);
  });
  it("rejects an old invitation both at the public boundary and after acquiring the team lock", async () => {
    const actions = createInviteResponseActions({
      database: database.db,
      getSession: async () => actors.outsider,
    });
    expect(await actions.acceptTeamInvite({ token })).toEqual({
      ok: false,
      code: "INVITE_INVALID",
    });
    await expect(
      acceptTeamInvite({ token, userId: actors.outsider.userId }, database.db),
    ).rejects.toMatchObject({ code: "INVITE_INVALID" });
    await expect(
      createJoinRequest(
        { teamId, userId: actors.outsider.userId, message: null },
        database.db,
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
