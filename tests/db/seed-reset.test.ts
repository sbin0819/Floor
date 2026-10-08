import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createAuth, type AuthInstance } from "@/lib/auth/auth";
import * as seedDal from "@/lib/dal/seed";
import { inspectSeedReset } from "@/lib/dal/seed-reset";
import {
  authAccounts,
  authSessions,
  authVerifications,
  branches,
  users,
} from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import { seedMigrations } from "@/lib/seed/migrations";
import { runSeed } from "@/lib/seed/run-seed";
import { createTestDatabase, type TestDatabase } from "./helper";

const now = new Date("2026-10-09T03:00:00Z");
describe("explicit full development reset", () => {
  let database: TestDatabase;
  let auth: AuthInstance;
  beforeAll(async () => {
    database = await createTestDatabase();
    auth = createAuth({
      db: database.db,
      email: createMemoryEmailSender(),
      secret: "reset-tests-secret-with-at-least-32-bytes",
      baseUrl: "http://localhost:3000",
      rateLimit: { enabled: false },
    });
  });
  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await database?.client.close();
  });
  const reset = () =>
    runSeed({
      db: database.db,
      auth,
      now,
      resetPasswords: false,
      resetData: true,
    });
  const migrations = () =>
    database.db
      .select({ hash: sql<string>`hash`, at: sql<string>`created_at::text` })
      .from(sql`drizzle.__drizzle_migrations`)
      .orderBy(sql`id`);
  const snapshot = async () => {
    const inspected = await inspectSeedReset(seedMigrations(), database.db);
    const contents: Record<string, unknown> = {};
    for (const name of Object.keys(inspected.counts)) {
      const [row] = await database.db
        .select({
          rows: sql<unknown>`coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb)`,
        })
        .from(sql`${sql.identifier("public")}.${sql.identifier(name)} t`);
      contents[name] = row!.rows;
    }
    return contents;
  };

  it("rebuilds all app data and credentials atomically while preserving schema, extensions and migration history", async () => {
    const [legacy] = await database.db
      .insert(users)
      .values({
        email: "legacy@example.test",
        name: "이전 회원",
        emailVerified: true,
      })
      .returning();
    await database.db.insert(authAccounts).values({
      userId: legacy!.id,
      accountId: legacy!.id,
      providerId: "credential",
      password: "old-test-only-hash",
    });
    await database.db.insert(authSessions).values({
      userId: legacy!.id,
      token: "old-test-only-session",
      expiresAt: new Date("2027-01-01Z"),
    });
    await database.db.insert(authVerifications).values({
      identifier: "old-test-only-identifier",
      value: "old-test-only-token",
      expiresAt: new Date("2027-01-01Z"),
    });
    const journal = await migrations();
    const result = await reset();
    expect(result.reset?.counts).toMatchObject({
      users: 1,
      auth_accounts: 1,
      auth_sessions: 1,
      auth_verifications: 1,
    });
    expect(result.counts).toMatchObject({
      users: 21,
      branches: 5,
      spaces: 71,
      bookings: 30,
      meetingRooms: 21,
      chatMessages: 44,
    });
    expect(
      await database.db.select().from(users).where(eq(users.id, legacy!.id)),
    ).toEqual([]);
    expect(await database.db.select().from(authSessions)).toEqual([]);
    expect(await database.db.select().from(authVerifications)).toEqual([]);
    expect(await database.db.select().from(authAccounts)).toHaveLength(21);
    expect(await migrations()).toEqual(journal);
    expect(
      await database.db
        .select({ name: sql<string>`extname` })
        .from(sql`pg_catalog.pg_extension`)
        .where(sql`extname = 'btree_gist'`),
    ).toHaveLength(1);
    const first = (await inspectSeedReset(seedMigrations(), database.db))
      .counts;
    await reset();
    expect(
      (await inspectSeedReset(seedMigrations(), database.db)).counts,
    ).toEqual(first);
    expect(await migrations()).toEqual(journal);
  }, 60000);

  it("restores every previous row when account preparation succeeded but later seeding fails", async () => {
    await database.db
      .update(branches)
      .set({ name: "롤백 시 남아야 하는 지점" })
      .where(eq(branches.id, "15eeb72a-6e7f-57ca-a905-d8797f988992"));
    const before = await snapshot();
    vi.spyOn(seedDal, "insertSeedBooking").mockRejectedValueOnce(
      new Error("injected later failure"),
    );
    await expect(reset()).rejects.toThrow("완료 여부를 확인하지 못했어요");
    expect(await snapshot()).toEqual(before);
  }, 60000);

  it("repopulates public tables even when a temporary table shadows the user table", async () => {
    await database.db.execute(sql`create temporary table users (marker text)`);
    await database.db.execute(sql`insert into pg_temp.users values ('keep')`);
    await database.db.execute(sql`set search_path = pg_temp, public`);
    try {
      await reset();
      expect(
        await database.db
          .select({ count: sql<number>`count(*)::integer` })
          .from(sql`public.users`),
      ).toEqual([{ count: 21 }]);
      expect(
        await database.db
          .select({ marker: sql<string>`marker` })
          .from(sql`pg_temp.users`),
      ).toEqual([{ marker: "keep" }]);
    } finally {
      await database.db.execute(sql`reset search_path`);
      await database.db.execute(sql`drop table pg_temp.users`);
    }
  }, 60000);

  it("does not claim a rollback or retry when a successful commit response is lost", async () => {
    const transaction = vi.fn(
      async (callback: Parameters<typeof database.db.transaction>[0]) => {
        await database.db.transaction(callback);
        throw new Error("simulated lost commit response");
      },
    );
    await expect(
      runSeed({
        db: { transaction },
        auth,
        now,
        resetPasswords: false,
        resetData: true,
      }),
    ).rejects.toThrow("자동으로 다시 실행하지 말고");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(await database.db.select().from(users)).toHaveLength(21);
  }, 60000);

  it("rejects an unknown public table without deleting existing app rows", async () => {
    await database.db.execute(
      sql`create table public.reset_unknown_guard (id integer primary key)`,
    );
    try {
      await database.db.execute(
        sql`insert into public.reset_unknown_guard values (1)`,
      );
      await expect(reset()).rejects.toThrow("허용 목록");
      expect(await database.db.select().from(users)).toHaveLength(21);
      expect(
        await database.db
          .select({ id: sql<number>`id` })
          .from(sql`public.reset_unknown_guard`),
      ).toEqual([{ id: 1 }]);
    } finally {
      await database.db.execute(sql`drop table public.reset_unknown_guard`);
    }
  });

  it("rejects foreign-schema references even when their delete action is cascade", async () => {
    await database.db.execute(sql`create schema reset_external_guard`);
    await database.db.execute(
      sql`create table reset_external_guard.links (user_id uuid references public.users(id) on delete cascade)`,
    );
    try {
      const [user] = await database.db.select().from(users);
      await database.db.execute(
        sql`insert into reset_external_guard.links values (${user!.id})`,
      );
      await expect(reset()).rejects.toThrow("외부 참조");
      expect(await database.db.select().from(users)).toHaveLength(21);
      expect(
        await database.db
          .select({ id: sql<string>`user_id` })
          .from(sql`reset_external_guard.links`),
      ).toEqual([{ id: user!.id }]);
    } finally {
      await database.db.execute(sql`drop table reset_external_guard.links`);
      await database.db.execute(sql`drop schema reset_external_guard`);
    }
  });

  it("rejects an unexpected trigger without running it", async () => {
    await database.db.execute(
      sql`create function public.reset_test_trigger() returns trigger language plpgsql as $$ begin raise exception 'must not run'; end; $$`,
    );
    await database.db.execute(
      sql`create trigger reset_test_trigger before truncate on public.users for each statement execute function public.reset_test_trigger()`,
    );
    try {
      await expect(reset()).rejects.toThrow("트리거");
    } finally {
      await database.db.execute(
        sql`drop trigger reset_test_trigger on public.users`,
      );
      await database.db.execute(sql`drop function public.reset_test_trigger()`);
    }
    expect(await database.db.select().from(users)).toHaveLength(21);
  });

  it("rejects mismatched migration history before deleting any data", async () => {
    const before = await snapshot();
    await expect(
      database.db.transaction(async (tx) => {
        await tx.execute(
          sql`update drizzle.__drizzle_migrations set hash = 'changed' where id = (select min(id) from drizzle.__drizzle_migrations)`,
        );
        await inspectSeedReset(seedMigrations(), tx);
      }),
    ).rejects.toThrow("마이그레이션 이력");
    expect(await snapshot()).toEqual(before);
  });

  it.each([
    { resetPasswords: true },
    { branchIds: [] },
    { bookingRound2: { hostHash: "a".repeat(64), receipt: null } },
  ])(
    "rejects mixed reset scopes before opening a transaction: %j",
    async (extra) => {
      const transaction = vi.fn();
      await expect(
        runSeed({
          db: { transaction },
          auth,
          now,
          resetPasswords: false,
          resetData: true,
          ...extra,
        }),
      ).rejects.toThrow("전체 초기화");
      expect(transaction).not.toHaveBeenCalled();
    },
  );
});
