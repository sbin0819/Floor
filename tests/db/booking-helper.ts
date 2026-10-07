import { sql } from "drizzle-orm";
import type { Session } from "@/lib/auth/types";
import {
  accessGrants,
  bookings,
  branches,
  branchStaff,
  floors,
  spaces,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import type { TestDatabase } from "./helper";

export const bookingNow = new Date("2026-10-07T03:10:00Z");
export const bookingDate = "2026-10-07";
export const bookingInstant = (time: string, date = bookingDate) =>
  `${date}T${time}:00+09:00`;
export const bookingRange = (
  start = "12:00",
  end = "13:00",
  date = bookingDate,
) => ({
  start: new Date(bookingInstant(start, date)),
  end: new Date(bookingInstant(end, date)),
});

export async function seedBookingActors(database: TestDatabase) {
  await database.db.execute(sql`TRUNCATE users, branches CASCADE`);
  const actor = (key: string, name: string): Session => ({
    userId: crypto.randomUUID(),
    name,
    email: `${key}@example.test`,
  });
  const actors = {
    person: actor("person", "김하은"),
    member: actor("member", "그로스 팀원"),
    admin: actor("admin", "그로스 관리자"),
    otherMember: actor("other-member", "플랫폼 팀원"),
    stranger: actor("stranger", "다른 예약자"),
    operator: actor("operator", "강남 운영자"),
    otherOperator: actor("other-operator", "다른 지점 운영자"),
  };
  await database.db.insert(users).values(
    Object.values(actors).map(({ userId, ...user }) => ({
      id: userId,
      ...user,
      emailVerified: true,
    })),
  );
  const ids = {
    branchId: crypto.randomUUID(),
    otherBranchId: crypto.randomUUID(),
    floorId: crypto.randomUUID(),
    restrictedFloorId: crypto.randomUUID(),
    otherFloorId: crypto.randomUUID(),
    publicSpaceId: crypto.randomUUID(),
    secondSpaceId: crypto.randomUUID(),
    restrictedSpaceId: crypto.randomUUID(),
    closedSpaceId: crypto.randomUUID(),
    archivedSpaceId: crypto.randomUUID(),
    deskAreaId: crypto.randomUUID(),
    deskId: crypto.randomUUID(),
    otherDeskId: crypto.randomUUID(),
    restrictedFloorSpaceId: crypto.randomUUID(),
    otherSpaceId: crypto.randomUUID(),
    teamId: crypto.randomUUID(),
    otherTeamId: crypto.randomUUID(),
  };
  await database.db.insert(branches).values([
    {
      id: ids.branchId,
      name: "강남점",
      address: "가상로 7",
      openHours: { sun: null },
    },
    { id: ids.otherBranchId, name: "서초점", address: "가상로 8" },
  ]);
  await database.db.insert(floors).values([
    {
      id: ids.floorId,
      branchId: ids.branchId,
      level: 7,
      name: "7F",
      sortOrder: 1,
    },
    {
      id: ids.restrictedFloorId,
      branchId: ids.branchId,
      level: 8,
      name: "8F",
      access: "teams",
      sortOrder: 2,
    },
    { id: ids.otherFloorId, branchId: ids.otherBranchId, level: 2, name: "2F" },
  ]);
  await database.db.insert(spaces).values([
    {
      id: ids.publicSpaceId,
      floorId: ids.floorId,
      type: "meeting_room",
      name: "회의실 B",
      capacity: 4,
      amenities: ["monitor"],
    },
    {
      id: ids.secondSpaceId,
      floorId: ids.floorId,
      type: "seminar",
      name: "세미나실",
    },
    {
      id: ids.restrictedSpaceId,
      floorId: ids.floorId,
      type: "meeting_room",
      name: "회의실 A",
      access: "teams",
      capacity: 8,
    },
    {
      id: ids.closedSpaceId,
      floorId: ids.floorId,
      type: "phone_booth",
      name: "닫힌 공간 비공개",
      access: "closed",
    },
    {
      id: ids.archivedSpaceId,
      floorId: ids.floorId,
      type: "lounge",
      name: "보관한 공간",
      archivedAt: bookingNow,
    },
    {
      id: ids.deskAreaId,
      floorId: ids.floorId,
      type: "desk_area",
      name: "데스크 구역",
      bookable: false,
    },
    {
      id: ids.restrictedFloorSpaceId,
      floorId: ids.restrictedFloorId,
      type: "meeting_room",
      name: "8층 비공개 공간",
    },
    {
      id: ids.otherSpaceId,
      floorId: ids.otherFloorId,
      type: "meeting_room",
      name: "서초 회의실",
    },
  ]);
  await database.db.insert(spaces).values([
    {
      id: ids.deskId,
      floorId: ids.floorId,
      parentId: ids.deskAreaId,
      type: "desk",
      name: "좌석 1",
    },
    {
      id: ids.otherDeskId,
      floorId: ids.floorId,
      parentId: ids.deskAreaId,
      type: "desk",
      name: "좌석 2",
    },
  ]);
  await database.db.insert(teams).values([
    {
      id: ids.teamId,
      name: "그로스팀",
      createdBy: actors.admin.userId,
      homeBranchId: ids.branchId,
    },
    {
      id: ids.otherTeamId,
      name: "플랫폼팀",
      createdBy: actors.otherMember.userId,
      homeBranchId: ids.otherBranchId,
    },
  ]);
  await database.db.insert(teamMembers).values([
    { teamId: ids.teamId, userId: actors.admin.userId, role: "admin" },
    { teamId: ids.teamId, userId: actors.member.userId, role: "member" },
    { teamId: ids.otherTeamId, userId: actors.member.userId, role: "member" },
    {
      teamId: ids.otherTeamId,
      userId: actors.otherMember.userId,
      role: "admin",
    },
  ]);
  await database.db.insert(branchStaff).values([
    { branchId: ids.branchId, userId: actors.operator.userId },
    { branchId: ids.otherBranchId, userId: actors.otherOperator.userId },
  ]);
  await database.db.insert(accessGrants).values([
    {
      targetType: "space",
      targetId: ids.restrictedSpaceId,
      teamId: ids.teamId,
    },
    {
      targetType: "floor",
      targetId: ids.restrictedFloorId,
      teamId: ids.teamId,
    },
  ]);
  return { ...actors, ...ids };
}

export type BookingActors = Awaited<ReturnType<typeof seedBookingActors>>;

export function bookingInput(
  fixture: BookingActors,
  overrides: Partial<{
    spaceId: string;
    start: string;
    end: string;
    teamId: string | null;
    title: string;
  }> = {},
) {
  return {
    spaceId: fixture.publicSpaceId,
    start: bookingInstant("12:00"),
    end: bookingInstant("13:00"),
    teamId: null,
    ...overrides,
  };
}

export async function insertFixtureBooking(
  database: TestDatabase,
  fixture: BookingActors,
  overrides: Partial<typeof bookings.$inferInsert> = {},
) {
  const [row] = await database.db
    .insert(bookings)
    .values({
      spaceId: fixture.publicSpaceId,
      userId: fixture.person.userId,
      during: bookingRange(),
      createdAt: bookingNow,
      ...overrides,
    })
    .returning();
  if (!row) throw new Error("Expected a fixture booking.");
  return row;
}
