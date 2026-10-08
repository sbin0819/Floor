import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { createTeamInfoActions } from "@/features/teams/manage-info-factory";
import type { TeamManagementDependencies } from "@/features/teams/manage-support";
import type { Session } from "@/lib/auth/types";
import type { RealtimeItem } from "@/lib/realtime/types";
import * as schema from "@/lib/db/schema";
import {
  chatRooms,
  messages,
  notifications,
  teamMembers,
  teams,
} from "@/lib/db/schema";
import { createTeamSpace } from "@/lib/dal/chat-write";
import * as teamWrites from "@/lib/dal/teams-write";
import * as manage from "@/lib/dal/teams-manage";
import { createTestDatabase, type TestDatabase } from "./helper";
import { seedTeam, seedTeamActors, type TeamActors } from "./team-helper";

describe("team information, role and title mutations", () => {
  let database: TestDatabase;
  let actors: TeamActors;
  let teamId: string;
  let spaceId: string;
  let roomId: string;
  const now = new Date("2026-10-09T03:00:00Z");
  let publishMany: ReturnType<
    typeof vi.fn<(items: readonly RealtimeItem[]) => Promise<void>>
  >;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  afterEach(() => vi.restoreAllMocks());
  beforeEach(async () => {
    actors = await seedTeamActors(database);
    teamId = (await seedTeam(database, actors.owner)).id;
    await database.db
      .insert(teamMembers)
      .values({ teamId, userId: actors.member.userId });
    const space = await createTeamSpace(teamId, database.db);
    spaceId = space.spaceId;
    roomId = space.roomId!;
    publishMany = vi.fn().mockResolvedValue(undefined);
  });
  const actions = (
    session: Session | null = actors.owner,
    overrides: TeamManagementDependencies = {},
  ) =>
    createTeamInfoActions({
      database: database.db,
      getSession: async () => session,
      now: () => now,
      publisher: { publish: vi.fn(), publishMany },
      logError: vi.fn(),
      ...overrides,
    });
  const update = (name = "새 팀") => ({
    teamId,
    name,
    homeBranchId: actors.branchId,
    headcount: 30,
    contactPhone: "+82 10-1234-5678",
  });
  const target = () => ({ teamId, userId: actors.member.userId });

  it("normalizes fields and records one rename in the first active text room before publishing", async () => {
    publishMany.mockImplementation(async () => {
      expect(
        (await database.db.select().from(teams).where(eq(teams.id, teamId)))[0]
          ?.name,
      ).toBe("새 팀");
      expect(await database.db.select().from(messages)).toHaveLength(1);
    });
    expect(await actions().updateTeam(update(" 새   팀 "))).toEqual({
      ok: true,
      data: { teamId },
    });
    expect(
      (await database.db.select().from(teams).where(eq(teams.id, teamId)))[0],
    ).toMatchObject({
      name: "새 팀",
      headcount: 30,
      homeBranchId: actors.branchId,
      contactPhone: "+821012345678",
    });
    expect(await database.db.select().from(messages)).toMatchObject([
      {
        roomId,
        kind: "system",
        authorId: null,
        systemData: {
          type: "team_renamed",
          actorName: actors.owner.name,
          name: "새 팀",
        },
        createdAt: now,
      },
    ]);
    expect(publishMany).toHaveBeenCalledExactlyOnceWith(
      expect.arrayContaining([
        expect.objectContaining({
          channel: `room:${roomId}`,
          event: expect.objectContaining({ type: "message.created" }),
        }),
        {
          channel: `space:${spaceId}`,
          event: { type: "space.changed", spaceId },
        },
      ]),
    );
  });

  it("does not create a rename message for an unchanged normalized name", async () => {
    expect((await actions().updateTeam(update("  가상   팀  "))).ok).toBe(true);
    expect(await database.db.select().from(messages)).toEqual([]);
    expect(publishMany).not.toHaveBeenCalled();
  });
  it("renames a team with no active text channel without making a new channel", async () => {
    await database.db
      .update(chatRooms)
      .set({ archivedAt: now })
      .where(eq(chatRooms.id, roomId));
    expect((await actions().updateTeam(update())).ok).toBe(true);
    expect(await database.db.select().from(messages)).toEqual([]);
    expect(await database.db.select().from(chatRooms)).toHaveLength(2);
  });
  it("skips a channel archived before the rename locks it", async () => {
    const original = manage.lockFirstTeamTextChannel;
    vi.spyOn(manage, "lockFirstTeamTextChannel").mockImplementationOnce(
      async (id, tx) => {
        await tx
          .update(chatRooms)
          .set({ archivedAt: now })
          .where(eq(chatRooms.id, roomId));
        return original(id, tx);
      },
    );
    expect((await actions().updateTeam(update())).ok).toBe(true);
    expect(await database.db.select().from(messages)).toEqual([]);
  });
  it("returns the existing unique error and rolls back the other edited fields", async () => {
    await seedTeam(database, actors.otherOwner, "새 팀");
    expect(await actions().updateTeam(update())).toEqual({
      ok: false,
      code: "TEAM_NAME_TAKEN",
    });
    expect(
      (await database.db.select().from(teams).where(eq(teams.id, teamId)))[0]
        ?.headcount,
    ).toBe(5);
    expect(await database.db.select().from(messages)).toEqual([]);
  });
  it("allows the name of a soft-deleted team", async () => {
    const deleted = await seedTeam(database, actors.otherOwner, "새 팀");
    await database.db
      .update(teams)
      .set({ deletedAt: now, deletedBy: actors.otherOwner.userId })
      .where(eq(teams.id, deleted.id));
    expect((await actions().updateTeam(update())).ok).toBe(true);
  });
  it.each([null, "00000000-0000-4000-8000-000000000001"])(
    "rejects unavailable home branch %s",
    async (homeBranchId) => {
      expect(
        await actions().updateTeam({ ...update(), homeBranchId }),
      ).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
        fieldErrors: { homeBranchId: [expect.any(String)] },
      });
    },
  );
  it.each(["updateTeam", "setMemberRole", "setMemberTitle"] as const)(
    "checks membership before %s and denies member management",
    async (method) => {
      const input =
        method === "updateTeam"
          ? update()
          : method === "setMemberRole"
            ? { ...target(), role: "admin" }
            : { teamId, userId: actors.owner.userId, title: "변경" };
      expect(await actions(actors.outsider)[method](input)).toEqual({
        ok: false,
        code: "NOT_FOUND",
      });
      expect(await actions(actors.member)[method](input)).toEqual({
        ok: false,
        code: "FORBIDDEN",
      });
    },
  );
  it.each(["demoted", "removed"])(
    "rechecks an actor %s while waiting for the team lock",
    async (change) => {
      const original = teamWrites.lockTeam;
      vi.spyOn(teamWrites, "lockTeam").mockImplementationOnce(
        async (id, tx) => {
          const where = and(
            eq(teamMembers.teamId, id),
            eq(teamMembers.userId, actors.owner.userId),
          );
          if (change === "demoted")
            await tx.update(teamMembers).set({ role: "member" }).where(where);
          else await tx.delete(teamMembers).where(where);
          return original(id, tx);
        },
      );
      expect(await actions().updateTeam(update())).toEqual({
        ok: false,
        code: change === "demoted" ? "FORBIDDEN" : "NOT_FOUND",
      });
      expect(await database.db.select().from(messages)).toEqual([]);
    },
  );
  it("promotes another member, snapshots the actor/team, and notifies only that member", async () => {
    expect(
      await actions().setMemberRole({ ...target(), role: "admin" }),
    ).toEqual({ ok: true, data: { teamId } });
    expect(await database.db.select().from(notifications)).toMatchObject([
      {
        type: "team_role_changed",
        userId: actors.member.userId,
        actorId: actors.owner.userId,
        data: {
          actorName: actors.owner.name,
          teamName: "가상 팀",
          teamId,
          role: "admin",
        },
        scheduledFor: now,
      },
    ]);
    expect(publishMany).toHaveBeenCalledWith(
      expect.arrayContaining([
        {
          channel: `user:${actors.member.userId}`,
          event: { type: "notifications.changed" },
        },
        {
          channel: `space:${spaceId}`,
          event: { type: "space.changed", spaceId },
        },
      ]),
    );
  });
  it("treats an unchanged role as no-op, including the last admin", async () => {
    expect(
      (
        await actions().setMemberRole({
          teamId,
          userId: actors.owner.userId,
          role: "admin",
        })
      ).ok,
    ).toBe(true);
    expect(await database.db.select().from(notifications)).toEqual([]);
    expect(publishMany).not.toHaveBeenCalled();
  });
  it("never demotes the last admin, but permits self-demotion after another admin exists", async () => {
    expect(
      await actions().setMemberRole({
        teamId,
        userId: actors.owner.userId,
        role: "member",
      }),
    ).toEqual({ ok: false, code: "LAST_ADMIN" });
    await actions().setMemberRole({ ...target(), role: "admin" });
    await database.db.delete(notifications);
    expect(
      (
        await actions().setMemberRole({
          teamId,
          userId: actors.owner.userId,
          role: "member",
        })
      ).ok,
    ).toBe(true);
    expect(await database.db.select().from(notifications)).toEqual([]);
  });
  it("enforces five active managed teams and excludes deleted ones", async () => {
    const managed = [];
    for (let i = 0; i < 5; i++)
      managed.push(await seedTeam(database, actors.member, `다른 팀 ${i}`));
    expect(
      await actions().setMemberRole({ ...target(), role: "admin" }),
    ).toEqual({ ok: false, code: "LIMIT_EXCEEDED", message: "admin_teams" });
    await database.db
      .update(teams)
      .set({ deletedAt: now, deletedBy: actors.member.userId })
      .where(eq(teams.id, managed[0]!.id));
    expect(
      (await actions().setMemberRole({ ...target(), role: "admin" })).ok,
    ).toBe(true);
  });
  it("lets a member edit only their own title, trims it, and maps empty to null without notification", async () => {
    expect(
      (
        await actions(actors.member).setMemberTitle({
          ...target(),
          title: "  디자이너  ",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await database.db
          .select()
          .from(teamMembers)
          .where(eq(teamMembers.userId, actors.member.userId))
      )[0]?.title,
    ).toBe("디자이너");
    expect(
      (
        await actions(actors.member).setMemberTitle({
          ...target(),
          title: "   ",
        })
      ).ok,
    ).toBe(true);
    expect(
      (
        await database.db
          .select()
          .from(teamMembers)
          .where(eq(teamMembers.userId, actors.member.userId))
      )[0]?.title,
    ).toBeNull();
    expect(
      await actions().setMemberTitle({ ...target(), title: "x".repeat(41) }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    expect(await database.db.select().from(notifications)).toEqual([]);
  });
  it.each(["setMemberRole", "setMemberTitle"] as const)(
    "rejects a non-member target for %s",
    async (method) => {
      expect(
        await actions()[method]({
          teamId,
          userId: actors.outsider.userId,
          ...(method === "setMemberRole"
            ? { role: "admin" }
            : { title: "제목" }),
        }),
      ).toEqual({ ok: false, code: "NOT_FOUND" });
    },
  );
  it("locks sorted users once at final strength, before team and memberships, without floor/space locks", async () => {
    const statements: { sql: string; params: unknown[] }[] = [];
    const logged = drizzle({
      client: database.client,
      schema,
      logger: {
        logQuery(sql, params) {
          statements.push({ sql, params });
        },
      },
    });
    expect(
      (
        await actions(actors.owner, { database: logged }).setMemberRole({
          ...target(),
          role: "admin",
        })
      ).ok,
    ).toBe(true);
    const locks = statements.filter(({ sql }) =>
      /for (update|key share)/u.test(sql),
    );
    expect(locks.slice(0, 2).map(({ params }) => params[0])).toEqual(
      [actors.owner.userId, actors.member.userId].sort(),
    );
    expect(
      locks
        .slice(0, 2)
        .every(({ sql }) => /from "users".*for update/u.test(sql)),
    ).toBe(true);
    expect(locks[2]?.sql).toMatch(/from "teams".*for update/u);
    expect(locks[3]?.sql).toMatch(/from "team_members".*for update/u);
    expect(locks).toHaveLength(4);
  });
  it("rolls back a late rename-message failure with the team update", async () => {
    vi.spyOn(manage, "lockFirstTeamTextChannel").mockRejectedValueOnce(
      new Error("private failure"),
    );
    expect(await actions().updateTeam(update())).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(
      (await database.db.select().from(teams).where(eq(teams.id, teamId)))[0]
        ?.name,
    ).toBe("가상 팀");
    expect(publishMany).not.toHaveBeenCalled();
  });
  it("does not turn a committed update into failure when publication fails", async () => {
    publishMany.mockRejectedValue(new Error("private publish failure"));
    const logError = vi.fn();
    expect(
      (await actions(actors.owner, { logError }).updateTeam(update())).ok,
    ).toBe(true);
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      "Team realtime publication failed.",
    );
  });
  it("retains success even when both publication and its error logger fail", async () => {
    publishMany.mockRejectedValue(new Error("private publish failure"));
    const logError = vi.fn(() => {
      throw new Error("private log failure");
    });
    expect(
      await actions(actors.owner, { logError }).updateTeam(update()),
    ).toEqual({ ok: true, data: { teamId } });
    expect(
      (await database.db.select().from(teams).where(eq(teams.id, teamId)))[0]
        ?.name,
    ).toBe("새 팀");
    expect(await database.db.select().from(messages)).toHaveLength(1);
  });
  it.each(["updateTeam", "setMemberRole", "setMemberTitle"] as const)(
    "authenticates before validating %s",
    async (method) => {
      expect(await actions(null)[method]({})).toEqual({
        ok: false,
        code: "UNAUTHENTICATED",
      });
      expect(
        await actions()[method]({
          ...update(),
          userId: actors.outsider.userId,
          forged: true,
        }),
      ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
    },
  );
});
