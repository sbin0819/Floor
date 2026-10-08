import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAdminQueries } from "@/features/admin/query-factory";
import { createBookingQueries } from "@/features/bookings/query-factory";
import { createTeamQueries } from "@/features/teams/query-factory";
import { createChatQueries } from "@/features/chat/query-factory";
import { createTeamSpace } from "@/lib/dal/chat-write";
import type { Session } from "@/lib/auth/types";
import { getOperatorBranches } from "@/lib/dal";
import {
  floors,
  spaces,
  teamInvites,
  teamJoinRequests,
  teamMembers,
  teams as teamTable,
  users,
} from "@/lib/db/schema";
import {
  bookingDate,
  bookingNow,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter, type QueryMeasurement } from "./query-meter";

describe("authenticated query execution budgets", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  let editableBookingId: string;
  let chat: { spaceId: string; roomId: string };
  let meter: ReturnType<typeof createQueryMeter>;
  const token = "query-budget-recipient-token";
  const measured: Record<string, QueryMeasurement> = {};

  beforeAll(async () => {
    database = await createTestDatabase();
    actors = await seedBookingActors(database);
    const created = await createTeamSpace(actors.teamId, database.db);
    if (!created.roomId) throw new Error("Expected a default team channel.");
    chat = { ...created, roomId: created.roomId };
    editableBookingId = (await insertFixtureBooking(database, actors)).id;
    await database.db.insert(teamInvites).values({
      teamId: actors.teamId,
      token,
      createdBy: actors.admin.userId,
      email: actors.person.email,
      expiresAt: new Date("2070-01-01T00:00:00Z"),
    });
    await database.db.insert(teamJoinRequests).values({
      teamId: actors.teamId,
      userId: actors.person.userId,
      message: "참여하고 싶어요",
    });
    await database.db
      .update(users)
      .set({ defaultBranchId: actors.branchId })
      .where(eq(users.id, actors.operator.userId));
    // 마이그레이션·가상 데이터·세션 조회는 화면 조회 예산에 포함하지 않는다.
    meter = createQueryMeter(database.client);
  });
  afterAll(async () => {
    console.info("QUERY_BUDGET", JSON.stringify(measured));
    meter.restore();
    await database.client.close();
  });

  const bookings = (session: Session = actors.member) =>
    createBookingQueries({
      database: database.db,
      requireSession: async () => session,
      now: () => bookingNow,
    });
  const teams = (session: Session = actors.person) =>
    createTeamQueries({
      database: database.db,
      requireSession: async () => session,
      canSendEmail: () => false,
    });
  const admin = () =>
    createAdminQueries({
      database: database.db,
      requireSession: async () => actors.operator,
    });
  const chatQueries = () =>
    createChatQueries({
      database: database.db,
      requireSession: async () => actors.member,
      now: () => bookingNow,
    });
  const cases: [string, () => Promise<unknown>][] = [
    ["chat.getMyChatNav", () => chatQueries().getMyChatNav()],
    [
      "chat.getRoomMessagesPage",
      () => chatQueries().getRoomMessagesPage(chat.roomId, { after: "0" }),
    ],
    [
      "chat.getChannelView",
      () => chatQueries().getChannelView(chat.spaceId, chat.roomId),
    ],
    ["bookings.getHomeHeader", () => bookings().getHomeHeader()],
    [
      "bookings.getHomeUpcomingBookings",
      () => bookings(actors.person).getHomeUpcomingBookings(),
    ],
    ["bookings.getHomeFreeSpaces", () => bookings().getHomeFreeSpaces()],
    ["bookings.getHomeBookingLimits", () => bookings().getHomeBookingLimits()],
    [
      "bookings.getBookingDestination",
      () => bookings().getBookingDestination(),
    ],
    ["bookings.getBranchList", () => bookings().getBranchList()],
    [
      "bookings.getBookingEntry.teamFallback",
      () => bookings().getBookingEntry(),
    ],
    [
      "bookings.getBookingEntry.noBranch",
      () => bookings(actors.person).getBookingEntry(),
    ],
    [
      "bookings.getBookingEntry.defaultBranch",
      () => bookings(actors.operator).getBookingEntry(),
    ],
    [
      "bookings.getBranchFloors",
      () => bookings().getBranchFloors(actors.branchId),
    ],
    [
      "bookings.getBranchNavigation",
      () => bookings().getBranchNavigation(actors.branchId),
    ],
    [
      "bookings.getFloorDay",
      () =>
        bookings().getFloorDay(actors.branchId, actors.floorId, bookingDate),
    ],
    [
      "bookings.getSpaceDay.memberTwoTeams",
      () =>
        bookings().getSpaceDay(
          actors.branchId,
          actors.floorId,
          actors.publicSpaceId,
          bookingDate,
        ),
    ],
    [
      "bookings.getSpaceDay.person",
      () =>
        bookings(actors.person).getSpaceDay(
          actors.branchId,
          actors.floorId,
          actors.publicSpaceId,
          bookingDate,
        ),
    ],
    ["bookings.getMyBookings", () => bookings(actors.person).getMyBookings()],
    [
      "bookings.getBookingForEdit",
      () => bookings(actors.person).getBookingForEdit(editableBookingId),
    ],
    ["teams.getHomeData", () => teams().getHomeData()],
    ["teams.getTeamStartData.search", () => teams().getTeamStartData("그로스")],
    ["teams.getTeamStartData.noSearch", () => teams().getTeamStartData()],
    [
      "teams.getTeamPageData.admin",
      () => teams(actors.admin).getTeamPageData(actors.teamId),
    ],
    [
      "teams.getTeamPageData.member",
      () => teams(actors.member).getTeamPageData(actors.teamId),
    ],
    ["teams.getInvitePageData", () => teams().getInvitePageData(token)],
    [
      "admin.getAdminBranch.twoFloors",
      () => admin().getAdminBranch(actors.branchId),
    ],
    [
      "admin.getAdminFloor.search",
      () => admin().getAdminFloor(actors.branchId, actors.floorId, "그로스"),
    ],
    [
      "admin.getAdminFloor.noSearch",
      () => admin().getAdminFloor(actors.branchId, actors.floorId),
    ],
    [
      "dal.getOperatorBranches",
      () => getOperatorBranches(actors.operator.userId, database.db),
    ],
  ];

  it.each(cases)(
    "measures %s after session validation",
    async (name, query) => {
      meter.start();
      await query();
      const result = meter.stop();
      measured[name] = result;
      expect(result.stages).toBeGreaterThan(0);
      expect(result.statements).toBe(
        result.perStage.reduce((sum, count) => sum + count, 0),
      );
      expect(result.stages).toBeLessThanOrEqual(
        [
          "bookings.getHomeFreeSpaces",
          "bookings.getHomeBookingLimits",
          "bookings.getBookingDestination",
          "bookings.getBookingForEdit",
        ].includes(name)
          ? 3
          : 2,
      );
      for (const count of result.perStage) expect(count).toBeLessThanOrEqual(6);
      if (name === "chat.getMyChatNav" || name === "chat.getRoomMessagesPage") {
        expect(result.stages).toBe(1);
        expect(result.statements).toBeLessThanOrEqual(
          name === "chat.getMyChatNav" ? 4 : 3,
        );
      }
    },
  );

  it("keeps statement counts independent of eight additional floors and team memberships", async () => {
    const extraFloors = Array.from({ length: 8 }, (_, index) => ({
      id: crypto.randomUUID(),
      branchId: actors.branchId,
      level: index + 10,
      name: `${index + 10}F`,
    }));
    const extraTeams = Array.from({ length: 8 }, (_, index) => ({
      id: crypto.randomUUID(),
      name: `추가 팀 ${index}`,
      createdBy: actors.admin.userId,
    }));
    await database.db.insert(floors).values(extraFloors);
    await database.db.insert(spaces).values(
      extraFloors.map((floor) => ({
        floorId: floor.id,
        name: "추가 회의실",
        type: "meeting_room" as const,
      })),
    );
    await database.db.insert(teamTable).values(extraTeams);
    await database.db.insert(teamMembers).values(
      extraTeams.map((team) => ({
        teamId: team.id,
        userId: actors.member.userId,
      })),
    );
    for (const name of [
      "bookings.getSpaceDay.memberTwoTeams",
      "bookings.getBranchFloors",
      "bookings.getHomeFreeSpaces",
      "bookings.getBranchList",
      "admin.getAdminBranch.twoFloors",
    ] as const) {
      const query = cases.find(([key]) => key === name)?.[1];
      if (!query) throw new Error("Missing query budget case.");
      meter.start();
      await query();
      const result = meter.stop();
      expect(result).toEqual(measured[name]);
    }
  });
});
