import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createHomeActions } from "@/features/home/action-factory";
import { createHomeQueries } from "@/features/home/query-factory";
import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import { readFriendsList } from "@/lib/dal/people-read";
import {
  bookingParticipants,
  chatRoomMembers,
  chatRooms,
  chatSpaceInvites,
  chatSpaceMembers,
  chatSpaces,
  friendships,
  teamInvites,
  teamJoinRequests,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import {
  bookingNow,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";
import { createQueryMeter } from "./query-meter";

describe("home todo, checklist, and dismissal", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    actors = await seedBookingActors(database);
  });

  const queries = (me: Session = actors.person) =>
    createHomeQueries({
      database: database.db,
      requireSession: async () => me,
      now: () => bookingNow,
    });
  const actions = (me: Session | null = actors.person, now = bookingNow) =>
    createHomeActions({
      database: database.db,
      getSession: async () => me,
      now: () => now,
      logError: vi.fn(),
    });
  async function team(
    name = crypto.randomUUID(),
    role: "admin" | "member" = "admin",
  ) {
    const [row] = await database.db
      .insert(teams)
      .values({ name, createdBy: actors.person.userId })
      .returning();
    await database.db
      .insert(teamMembers)
      .values({ teamId: row!.id, userId: actors.person.userId, role });
    return row!.id;
  }
  async function request(
    teamId: string,
    userId = actors.member.userId,
    status: "pending" | "approved" | "rejected" = "pending",
  ) {
    await database.db
      .insert(teamJoinRequests)
      .values({ teamId, userId, status });
  }
  async function invitation(
    overrides: Partial<typeof teamInvites.$inferInsert> = {},
  ) {
    const teamId = await team();
    await database.db.insert(teamInvites).values({
      teamId,
      token: crypto.randomUUID(),
      email: actors.person.email,
      createdBy: actors.admin.userId,
      expiresAt: new Date(bookingNow.getTime() + 60_000),
      ...overrides,
    });
    return teamId;
  }
  async function friend(
    other: Session,
    status: "pending" | "accepted" | "declined",
    outgoing = false,
  ) {
    const pair = [actors.person.userId, other.userId].sort();
    await database.db.insert(friendships).values({
      userLowId: pair[0]!,
      userHighId: pair[1]!,
      status,
      requestedBy: outgoing ? actors.person.userId : other.userId,
      requestedAt: bookingNow,
      statusChangedAt: bookingNow,
    });
  }
  async function spaceInvite(
    overrides: Partial<typeof chatSpaceInvites.$inferInsert> = {},
  ) {
    const [space] = await database.db
      .insert(chatSpaces)
      .values({
        kind: "community",
        name: "가상 모임",
        createdBy: actors.admin.userId,
      })
      .returning();
    const [invite] = await database.db
      .insert(chatSpaceInvites)
      .values({
        spaceId: space!.id,
        code: crypto.randomUUID(),
        createdBy: actors.admin.userId,
        targetUserId: actors.person.userId,
        createdAt: bookingNow,
        ...overrides,
      })
      .returning();
    return invite!;
  }

  it("returns only five safe todo projections and no invitation or user records", async () => {
    expect(await queries().getHomeTodo()).toEqual({
      joinRequests: { top: null, rest: 0 },
      teamInvites: 0,
      friendRequests: 0,
      messageRequests: 0,
      spaceInvites: { count: 0, href: null },
    });
  });

  it("ranks only an administrator's pending requests by count and sums the other teams", async () => {
    const top = await team("가장 많은 팀");
    const second = await team("다른 팀");
    const ordinary = await team("관리 권한 없는 팀", "member");
    await request(top);
    await request(top, actors.stranger.userId);
    await request(second);
    await request(ordinary);
    await request(actors.otherTeamId);
    await request(top, actors.operator.userId, "approved");
    await request(top, actors.otherOperator.userId, "rejected");
    expect((await queries().getHomeTodo()).joinRequests).toEqual({
      top: { teamId: top, teamName: "가장 많은 팀", count: 2 },
      rest: 1,
    });
  });

  it("breaks equal request counts by name and excludes deleted teams", async () => {
    const second = await team("Beta");
    const first = await team("Alpha");
    const deleted = await team("000 Deleted");
    await request(second);
    await request(first);
    await request(deleted);
    await database.db
      .update(teams)
      .set({ deletedAt: bookingNow, deletedBy: actors.person.userId })
      .where(eq(teams.id, deleted));
    expect((await queries().getHomeTodo()).joinRequests).toEqual({
      top: { teamId: first, teamName: "Alpha", count: 1 },
      rest: 1,
    });
  });

  it("counts only pending, unexpired invitations to the current verified email on active teams", async () => {
    await invitation();
    await invitation({ email: actors.member.email });
    await invitation({ email: null });
    await invitation({ acceptedAt: bookingNow });
    await invitation({ declinedAt: bookingNow });
    await invitation({ revokedAt: bookingNow });
    await invitation({ expiresAt: bookingNow });
    const deleted = await invitation();
    await database.db
      .update(teams)
      .set({ deletedAt: bookingNow, deletedBy: actors.person.userId })
      .where(eq(teams.id, deleted));
    expect((await queries().getHomeTodo()).teamInvites).toBe(1);
  });

  it("does not trust the session email or count invitations for an unverified database email", async () => {
    await invitation();
    await invitation({ email: "current@example.test" });
    await database.db
      .update(users)
      .set({ email: "current@example.test", emailVerified: false })
      .where(eq(users.id, actors.person.userId));
    expect((await queries().getHomeTodo()).teamInvites).toBe(0);
    await database.db
      .update(users)
      .set({ emailVerified: true })
      .where(eq(users.id, actors.person.userId));
    expect((await queries().getHomeTodo()).teamInvites).toBe(1);
  });

  it("shares the exact received friend request count with the friends screen", async () => {
    await friend(actors.member, "pending");
    await friend(actors.admin, "pending", true);
    await friend(actors.stranger, "declined");
    await friend(actors.otherMember, "accepted");
    const todo = await queries().getHomeTodo();
    const list = await readFriendsList(
      actors.person.userId,
      "received",
      bookingNow,
      database.db,
    );
    expect(todo.friendRequests).toBe(1);
    expect(todo.friendRequests).toBe(list!.receivedCount);
  });

  it("counts only nonempty message requests addressed to me", async () => {
    for (const [other, status, populated] of [
      [actors.admin, "requested", true],
      [actors.member, "active", true],
      [actors.stranger, "requested", false],
      [actors.otherMember, "left", true],
    ] as const) {
      const pair = [actors.person.userId, other.userId].sort();
      const [room] = await database.db
        .insert(chatRooms)
        .values({
          kind: "dm",
          dmLowUserId: pair[0]!,
          dmHighUserId: pair[1]!,
          lastMessageAt: populated ? bookingNow : null,
        })
        .returning();
      await database.db.insert(chatRoomMembers).values({
        roomId: room!.id,
        userId: actors.person.userId,
        status,
        requestedAt: status === "requested" ? bookingNow : null,
        joinedAt: bookingNow,
        statusChangedAt: bookingNow,
      });
    }
    expect((await queries().getHomeTodo()).messageRequests).toBe(1);
  });

  it("counts usable direct space invitations and links only to the latest", async () => {
    await spaceInvite({ createdAt: new Date(bookingNow.getTime() - 1) });
    const latest = await spaceInvite({
      maxUses: 2,
      useCount: 1,
      expiresAt: new Date(bookingNow.getTime() + 1),
    });
    const todo = await queries().getHomeTodo();
    expect(todo.spaceInvites).toEqual({
      count: 2,
      href: `/s/join/${latest.code}`,
    });
    expect(Object.keys(todo.spaceInvites).sort()).toEqual(["count", "href"]);
  });

  it.each([
    "public",
    "other",
    "revoked",
    "expired",
    "exhausted",
    "deleted",
    "active",
    "banned",
  ] as const)("excludes %s space invitations", async (reason) => {
    const invite = await spaceInvite({
      ...(reason === "public" ? { targetUserId: null } : {}),
      ...(reason === "other" ? { targetUserId: actors.member.userId } : {}),
      ...(reason === "revoked" ? { revokedAt: bookingNow } : {}),
      ...(reason === "expired" ? { expiresAt: bookingNow } : {}),
      ...(reason === "exhausted" ? { maxUses: 1, useCount: 1 } : {}),
    });
    if (reason === "deleted")
      await database.db
        .update(chatSpaces)
        .set({ deletedAt: bookingNow })
        .where(eq(chatSpaces.id, invite.spaceId));
    if (reason === "active" || reason === "banned")
      await database.db.insert(chatSpaceMembers).values({
        spaceId: invite.spaceId,
        userId: actors.person.userId,
        status: reason,
        joinedAt: bookingNow,
        statusChangedAt: bookingNow,
      });
    expect((await queries().getHomeTodo()).spaceInvites).toEqual({
      count: 0,
      href: null,
    });
  });

  it("uses a constant completed email step and leaves incomplete steps visible", async () => {
    await database.db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, actors.person.userId));
    expect(await queries().getHomeChecklist()).toEqual({
      visible: true,
      isOperator: false,
      dismissedAt: null,
      steps: {
        emailVerified: true,
        username: false,
        team: false,
        booking: false,
        friend: false,
      },
    });
  });

  it("counts only membership of a nondeleted team", async () => {
    const teamId = await team();
    expect((await queries().getHomeChecklist()).steps.team).toBe(true);
    await database.db
      .update(teams)
      .set({ deletedAt: bookingNow, deletedBy: actors.person.userId })
      .where(eq(teams.id, teamId));
    expect((await queries().getHomeChecklist()).steps.team).toBe(false);
  });

  it("ignores invited bookings but counts a cancelled booking I created", async () => {
    const booking = await insertFixtureBooking(database, actors, {
      userId: actors.member.userId,
    });
    await database.db.insert(bookingParticipants).values({
      bookingId: booking.id,
      userId: actors.person.userId,
    });
    expect((await queries().getHomeChecklist()).steps.booking).toBe(false);
    await insertFixtureBooking(database, actors, {
      status: "cancelled",
      cancelledAt: bookingNow,
      cancelledBy: actors.person.userId,
    });
    expect((await queries().getHomeChecklist()).steps.booking).toBe(true);
  });

  it("counts only accepted friends and hides a completely finished checklist", async () => {
    await friend(actors.member, "pending");
    expect((await queries().getHomeChecklist()).steps.friend).toBe(false);
    await friend(actors.admin, "accepted");
    await team();
    await insertFixtureBooking(database, actors);
    await database.db
      .update(users)
      .set({ username: "home.person" })
      .where(eq(users.id, actors.person.userId));
    expect(await queries().getHomeChecklist()).toEqual({
      visible: false,
      isOperator: false,
      dismissedAt: null,
      steps: {
        emailVerified: true,
        username: true,
        team: true,
        booking: true,
        friend: true,
      },
    });
  });

  it("does not show the checklist to an operator with incomplete steps", async () => {
    expect(await queries(actors.operator).getHomeChecklist()).toMatchObject({
      visible: false,
      isOperator: true,
      steps: { username: false, team: false, booking: false, friend: false },
    });
  });

  it("dismisses only the current user's checklist in one update and does not change its first timestamp", async () => {
    const before = await database.db.select().from(users).orderBy(users.id);
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      expect(await actions().dismissHomeChecklist({})).toEqual({
        ok: true,
        data: {},
      });
      expect(meter.stop().perStage).toEqual([1]);
      expect(
        await actions(
          undefined,
          new Date(bookingNow.getTime() + 60_000),
        ).dismissHomeChecklist({}),
      ).toEqual({ ok: true, data: {} });
    } finally {
      meter.restore();
    }
    const after = await database.db.select().from(users).orderBy(users.id);
    expect(after).toEqual(
      before.map((row) =>
        row.id === actors.person.userId
          ? { ...row, homeChecklistDismissedAt: bookingNow }
          : row,
      ),
    );
    expect(await queries().getHomeChecklist()).toMatchObject({
      visible: false,
      dismissedAt: bookingNow.toISOString(),
    });
  });

  it("checks authentication before input and refuses a client-selected user", async () => {
    expect(
      await actions(null).dismissHomeChecklist({
        userId: actors.member.userId,
      }),
    ).toEqual({ ok: false, code: "UNAUTHENTICATED" });
    expect(
      await actions().dismissHomeChecklist({ userId: actors.member.userId }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect((await queries().getHomeChecklist()).dismissedAt).toBeNull();
  });

  it("validates the session before all query SQL and reads the clock only once for time-sensitive todo", async () => {
    const denied = vi.fn(async () => {
      throw new ActionError("UNAUTHENTICATED");
    });
    const now = vi.fn(() => bookingNow);
    const subject = createHomeQueries({
      database: database.db,
      requireSession: denied,
      now,
    });
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      await expect(subject.getHomeTodo()).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
      await expect(subject.getHomeChecklist()).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
      expect(meter.stop().statements).toBe(0);
      expect(denied).toHaveBeenCalledTimes(2);
      expect(now).not.toHaveBeenCalled();
      const allowed = vi.fn(async () => actors.person);
      await createHomeQueries({
        database: database.db,
        requireSession: allowed,
        now,
      }).getHomeTodo();
      expect(allowed).toHaveBeenCalledOnce();
      expect(now).toHaveBeenCalledOnce();
    } finally {
      meter.restore();
    }
  });

  it("keeps populated todo and checklist within their one-stage SQL budgets", async () => {
    const teamId = await team();
    await request(teamId);
    await invitation();
    await spaceInvite();
    await friend(actors.member, "pending");
    const meter = createQueryMeter(database.client);
    try {
      meter.start();
      await queries().getHomeTodo();
      expect(meter.stop().perStage).toEqual([3]);
      meter.start();
      await queries().getHomeChecklist();
      expect(meter.stop().perStage).toEqual([1]);
    } finally {
      meter.restore();
    }
  });
});
