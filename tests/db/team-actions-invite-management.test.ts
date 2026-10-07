import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { eq } from "drizzle-orm";
import { createInviteManagementActions } from "@/features/teams/invite-management-factory";
import type { Session } from "@/lib/auth/types";
import {
  branchStaff,
  roleSettings,
  teamInvites,
  teamMembers,
} from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import { createTestDatabase, type TestDatabase } from "./helper";
import { seedTeam, seedTeamActors, type TeamActors } from "./team-helper";

describe("team invitation management actions", () => {
  let database: TestDatabase;
  let actors: TeamActors;
  let teamId: string;
  let email: ReturnType<typeof createMemoryEmailSender>;
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
      .values({ teamId, userId: actors.member.userId, role: "member" });
    email = createMemoryEmailSender();
  });
  const actions = (session: Session | null = actors.owner) =>
    createInviteManagementActions({
      database: database.db,
      getSession: async () => session,
      email,
      appUrl: "https://floor.example.test",
      logError: vi.fn(),
    });
  const input = () => ({
    teamId,
    email: actors.outsider.email.toUpperCase(),
    message: "함께 일해요",
  });

  it("stores a strong seven-day token and sends one correct email without returning the token", async () => {
    const result = await actions().sendTeamInvite(input());
    const invite = (await database.db.select().from(teamInvites))[0]!;
    expect(result).toEqual({ ok: true, data: { inviteId: invite.id } });
    expect(invite).toMatchObject({
      teamId,
      email: actors.outsider.email,
      createdBy: actors.owner.userId,
      message: "함께 일해요",
    });
    expect(Buffer.from(invite.token, "base64url")).toHaveLength(32);
    expect(
      invite.expiresAt.getTime() - invite.createdAt.getTime(),
    ).toBeGreaterThan(6.99 * 86400000);
    expect(email.messages).toHaveLength(1);
    expect(email.messages[0]).toMatchObject({
      to: actors.outsider.email,
      text: expect.stringContaining(
        `https://floor.example.test/invite/${invite.token}`,
      ),
    });
    expect(email.messages[0]?.text).toContain("가상 팀");
    expect(email.messages[0]?.text).toContain(actors.owner.name);
    expect(email.messages[0]?.text).toContain("함께 일해요");
  });

  it.each(["member", "outsider", "otherOwner", "operator"] as const)(
    "does not let a %s send invitations",
    async (actor) => {
      await seedTeam(database, actors.otherOwner, "다른 팀");
      await database.db
        .insert(branchStaff)
        .values({ branchId: actors.branchId, userId: actors.operator.userId });
      await database.db.insert(roleSettings).values({
        branchId: actors.branchId,
        role: "user",
        permissions: ["team.manage_members"],
      });
      expect(await actions(actors[actor]).sendTeamInvite(input())).toEqual({
        ok: false,
        code: "FORBIDDEN",
      });
      expect(await database.db.select().from(teamInvites)).toHaveLength(0);
      expect(email.messages).toHaveLength(0);
    },
  );

  it("rejects existing members, unknown teams and a forged sender", async () => {
    expect(
      await actions().sendTeamInvite({
        ...input(),
        email: actors.member.email,
      }),
    ).toEqual({ ok: false, code: "ALREADY_MEMBER" });
    expect(
      await actions().sendTeamInvite({
        ...input(),
        teamId: crypto.randomUUID(),
      }),
    ).toEqual({ ok: false, code: "NOT_FOUND" });
    expect(
      await actions().sendTeamInvite({
        ...input(),
        actorUserId: actors.otherOwner.userId,
      }),
    ).toMatchObject({ ok: false, code: "INVALID_INPUT" });
  });

  it("revokes the previous pending invitation when inviting the same email again", async () => {
    await actions().sendTeamInvite(input());
    const oldInvite = (await database.db.select().from(teamInvites))[0]!;
    await actions().sendTeamInvite(input());
    const invites = await database.db.select().from(teamInvites);
    expect(invites).toHaveLength(2);
    expect(
      invites.find((invite) => invite.id === oldInvite.id)?.revokedAt,
    ).toBeInstanceOf(Date);
    expect(invites.filter((invite) => !invite.revokedAt)).toHaveLength(1);
    expect(email.messages).toHaveLength(2);
  });

  it("resolves the invite's real team when cancelling and rejects another team's manager", async () => {
    await seedTeam(database, actors.otherOwner, "다른 팀");
    await actions().sendTeamInvite(input());
    const inviteId = (await database.db.select().from(teamInvites))[0]!.id;
    expect(
      await actions(actors.otherOwner).revokeTeamInvite({ inviteId }),
    ).toEqual({ ok: false, code: "FORBIDDEN" });
    expect(await actions().revokeTeamInvite({ inviteId })).toEqual({
      ok: true,
      data: { teamId },
    });
    expect(await actions().revokeTeamInvite({ inviteId })).toEqual({
      ok: false,
      code: "INVITE_INVALID",
    });
    expect(email.messages).toHaveLength(1);
  });

  it("counts expired pending invitations toward fifty but allows replacing one", async () => {
    await database.db.insert(teamInvites).values(
      Array.from({ length: 50 }, (_, index) => ({
        teamId,
        createdBy: actors.owner.userId,
        email: `pending-${index}@example.test`,
        token: `pending-token-${index}`,
        expiresAt: new Date(0),
      })),
    );
    expect(await actions().sendTeamInvite(input())).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
    });
    expect(
      (
        await actions().sendTeamInvite({
          ...input(),
          email: "pending-0@example.test",
        })
      ).ok,
    ).toBe(true);
    const rows = await database.db.select().from(teamInvites);
    expect(
      rows.filter(
        (invite) =>
          !invite.revokedAt && !invite.acceptedAt && !invite.declinedAt,
      ),
    ).toHaveLength(50);
    expect(rows).toHaveLength(51);
  });

  it("allows a manager to cancel an expired pending invitation", async () => {
    await actions().sendTeamInvite(input());
    const inviteId = (await database.db.select().from(teamInvites))[0]!.id;
    await database.db
      .update(teamInvites)
      .set({ expiresAt: new Date(0) })
      .where(eq(teamInvites.id, inviteId));
    expect((await actions().revokeTeamInvite({ inviteId })).ok).toBe(true);
  });

  it("keeps only one pending invite when two send requests compete", async () => {
    const results = await Promise.all([
      actions().sendTeamInvite(input()),
      actions().sendTeamInvite(input()),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(
      (await database.db.select().from(teamInvites)).filter(
        (invite) => !invite.revokedAt,
      ),
    ).toHaveLength(1);
  });

  it("sends only after commit and lets the sender read the committed invitation", async () => {
    let inTransaction = false;
    const observations: boolean[] = [];
    const db = new Proxy(database.db, {
      get(target, property, receiver) {
        if (property !== "transaction")
          return Reflect.get(target, property, receiver);
        return async <T>(
          callback: Parameters<typeof target.transaction<T>>[0],
        ) => {
          inTransaction = true;
          try {
            return await target.transaction(callback);
          } finally {
            inTransaction = false;
          }
        };
      },
    });
    const action = createInviteManagementActions({
      database: db,
      getSession: async () => actors.owner,
      appUrl: "https://floor.example.test",
      email: {
        async send() {
          observations.push(inTransaction);
          expect(await database.db.select().from(teamInvites)).toHaveLength(1);
        },
      },
    });
    expect((await action.sendTeamInvite(input())).ok).toBe(true);
    expect(observations).toEqual([false]);
  });

  it("returns saved-invite success after email failure and logs no secret details", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const action = createInviteManagementActions({
        database: database.db,
        getSession: async () => actors.owner,
        appUrl: "https://floor.example.test",
        email: {
          async send() {
            throw new Error("secret-token-password-email-body");
          },
        },
      });
      const result = await action.sendTeamInvite(input());
      expect(result.ok).toBe(true);
      expect(await database.db.select().from(teamInvites)).toHaveLength(1);
      expect(logged).toHaveBeenCalledExactlyOnceWith(
        "[teams] Invitation email delivery failed.",
      );
    } finally {
      logged.mockRestore();
    }
  });

  it("does not send mail when the database transaction rolls back", async () => {
    const db = new Proxy(database.db, {
      get(target, property, receiver) {
        if (property !== "transaction")
          return Reflect.get(target, property, receiver);
        return async <T>(
          callback: Parameters<typeof target.transaction<T>>[0],
        ) =>
          target.transaction(async (transaction) => {
            await callback(transaction);
            throw new Error("rollback");
          });
      },
    });
    const action = createInviteManagementActions({
      database: db,
      getSession: async () => actors.owner,
      email,
      appUrl: "https://floor.example.test",
      logError: vi.fn(),
    });
    expect(await action.sendTeamInvite(input())).toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(await database.db.select().from(teamInvites)).toHaveLength(0);
    expect(email.messages).toHaveLength(0);
  });

  it("requires authentication before either manager action validates input", async () => {
    for (const action of Object.values(actions(null)))
      expect(await action(null)).toEqual({
        ok: false,
        code: "UNAUTHENTICATED",
      });
  });
});
