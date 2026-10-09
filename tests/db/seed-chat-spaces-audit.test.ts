import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { types } from "@neondatabase/serverless";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  captureChatSpacesAudit,
  compareChatSpacesAudit,
  preflightChatSpacesMigrations,
  readChatSpacesLoungeCursor,
} from "@/lib/dal/seed-chat-spaces-audit";
import * as schema from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";

const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
const historicalStart = 19;
const historicalEnd = 25;
const userId = "a3000000-0000-4000-8000-000000000001";
const branchId = "a3000000-0000-4000-8000-000000000002";
const secret = "private-password-hash-not-for-audit-output";
const token = "private-session-token-not-for-audit-output";
let shared: TestDatabase;
beforeAll(async () => {
  shared = await createTestDatabase();
});
afterAll(async () => {
  await shared.client.close();
});

async function withDatabase(
  run: (
    database: TestDatabase["db"],
    client: PGlite,
    apply: (from: number, to: number) => Promise<void>,
  ) => Promise<void>,
  count = migrations.length,
) {
  const reuse = count === migrations.length;
  const client = reuse
    ? shared.client
    : new PGlite({ extensions: { btree_gist } });
  const database = reuse ? shared.db : drizzle({ client, schema });
  try {
    if (reuse) await client.exec("BEGIN");
    else
      await client.exec(
        "create schema drizzle; create table drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint)",
      );
    const apply = async (from: number, to: number) => {
      for (const migration of migrations.slice(from, to)) {
        await client.transaction(async (tx) => {
          for (const statement of migration.sql) await tx.exec(statement);
          await tx.query(
            "insert into drizzle.__drizzle_migrations(hash,created_at) values ($1,$2)",
            [migration.hash, migration.folderMillis],
          );
        });
      }
    };
    if (!reuse) await apply(0, count);
    await client.query(
      "insert into users(id,name,email,email_verified) values($1,'개인 이름 비공개','private-audit@example.test',true)",
      [userId],
    );
    await client.query("insert into branches(id,name) values($1,'가상 지점')", [
      branchId,
    ]);
    await client.query(
      "insert into auth_accounts(user_id,account_id,provider_id,password) values($1,$2,'credential',$3)",
      [userId, userId, secret],
    );
    await client.query(
      "insert into auth_sessions(user_id,token,expires_at) values($1,$2,'2030-01-01T00:00:00Z')",
      [userId, token],
    );
    await run(database, client, apply);
  } finally {
    if (reuse) await client.exec("ROLLBACK");
    else await client.close();
  }
}

async function lounge(client: PGlite) {
  const spaceId = crypto.randomUUID();
  const first = crypto.randomUUID();
  const second = crypto.randomUUID();
  await client.query(
    "insert into chat_spaces(id,kind,branch_id) values($1,'branch',$2)",
    [spaceId, branchId],
  );
  await client.query(
    "insert into chat_rooms(id,kind,space_id,name) values($1,'text',$3,'라운지'),($2,'text',$3,'공지')",
    [first, second, spaceId],
  );
  return { first, second };
}

async function existingBooking(client: PGlite) {
  const floorId = crypto.randomUUID();
  const spaceId = crypto.randomUUID();
  const bookingId = crypto.randomUUID();
  await client.query(
    "insert into floors(id,branch_id,name,level) values($1,$2,'7F',7)",
    [floorId, branchId],
  );
  await client.query(
    "insert into spaces(id,floor_id,type,name) values($1,$2,'meeting_room','회의실')",
    [spaceId, floorId],
  );
  await client.query(
    "insert into bookings(id,space_id,user_id,during,status,cancelled_at) values($1,$2,$3,'[2026-10-09T03:00:00Z,2026-10-09T04:00:00Z)','cancelled','2026-10-08T03:00:00Z')",
    [bookingId, spaceId, userId],
  );
  return bookingId;
}

describe("additive chat-space seed preservation audit", () => {
  it("returns catalog keys as text arrays understood by the installed Neon parser", async () =>
    withDatabase(async (_database, client) => {
      const queries: string[] = [];
      const database = drizzle({
        client,
        schema,
        logger: { logQuery: (query) => queries.push(query) },
      });
      await captureChatSpacesAudit({}, database);
      const metadataQuery = queries.find((query) =>
        query.includes("array_agg"),
      );
      expect(metadataQuery).toBeDefined();
      const metadata = await client.query(metadataQuery!);
      expect(metadata.fields[1]?.dataTypeID).toBe(1009);
      const parsed: unknown = types.getTypeParser(
        metadata.fields[1]!.dataTypeID,
        "text",
      )("{id,user_id}");
      expect(parsed).toEqual(["id", "user_id"]);
    }));

  it("captures exactly 36 app tables with keys and hashes, never raw personal or authentication values", async () =>
    withDatabase(async (database) => {
      const audit = await captureChatSpacesAudit({}, database);
      expect(audit.tables).toHaveLength(36);
      expect(audit.tables.every((table) => table.exists)).toBe(true);
      const serialized = JSON.stringify(audit);
      for (const sensitive of [
        secret,
        token,
        "private-audit@example.test",
        "개인 이름 비공개",
      ])
        expect(serialized).not.toContain(sensitive);
      expect(audit.tables.find(({ table }) => table === "users")!.rows).toEqual(
        [
          {
            key: JSON.stringify([userId]),
            hash: expect.stringMatching(/^[a-f0-9]{64}$/u),
          },
        ],
      );
      expect(
        compareChatSpacesAudit(
          audit,
          await captureChatSpacesAudit({ baseline: audit }, database),
        ),
      ).toEqual({ added: [], addedTables: [], addedColumns: [] });
      expect(await preflightChatSpacesMigrations(database)).toBe(0);
    }));

  it("preserves every old-column fingerprint across the actual six migrations and separately reports additions", async () =>
    withDatabase(async (database, client, apply) => {
      await existingBooking(client);
      expect(migrations.slice(historicalStart, historicalEnd)).toHaveLength(6);
      expect(await preflightChatSpacesMigrations(database)).toBe(
        migrations.length - historicalStart,
      );
      const before = await captureChatSpacesAudit({}, database);
      expect(
        before.tables
          .filter(({ exists }) => !exists)
          .map(({ table }) => table)
          .sort(),
      ).toEqual([
        "call_participants",
        "call_sessions",
        "chat_space_invites",
        "chat_space_members",
        "message_attachments",
      ]);
      await apply(historicalStart, historicalEnd);
      expect(await preflightChatSpacesMigrations(database)).toBe(
        migrations.length - historicalEnd,
      );
      const after = await captureChatSpacesAudit(
        { baseline: before },
        database,
      );
      const result = compareChatSpacesAudit(before, after);
      expect(result.addedTables.sort()).toEqual([
        "call_participants",
        "call_sessions",
        "chat_space_invites",
        "chat_space_members",
        "message_attachments",
      ]);
      expect(result.addedColumns).toEqual(
        expect.arrayContaining([
          {
            table: "users",
            columns: expect.arrayContaining([
              "avatar_color",
              "avatar_photo",
              "chat_toasts",
              "tab_badge",
              "reminder_minutes",
              "home_checklist_dismissed_at",
            ]),
          },
          { table: "teams", columns: ["deleted_at", "deleted_by"] },
          { table: "chat_rooms", columns: ["voice_capacity"] },
          { table: "chat_spaces", columns: ["icon_color"] },
        ]),
      );
      expect(
        result.added.map(({ table, count }) => ({ table, count })),
      ).toEqual(
        expect.arrayContaining([
          { table: "chat_rooms", count: 3 },
          { table: "chat_spaces", count: 1 },
        ]),
      );
      for (const table of [
        "users",
        "auth_accounts",
        "auth_sessions",
        "bookings",
      ] as const)
        expect(after.tables.find((row) => row.table === table)!.rows).toEqual(
          before.tables.find((row) => row.table === table)!.rows,
        );

      // 26–32의 여섯 마이그레이션 검증과 이후 스키마 진화를 별도로 확인한다.
      await apply(historicalEnd, migrations.length);
      expect(await preflightChatSpacesMigrations(database)).toBe(0);
      const latest = await captureChatSpacesAudit(
        { baseline: after },
        database,
      );
      const evolution = compareChatSpacesAudit(after, latest);
      expect(evolution.addedColumns).toContainEqual({
        table: "bookings",
        columns: ["cancel_kind", "cancel_reason"],
      });
      for (const table of [
        "users",
        "auth_accounts",
        "auth_sessions",
        "bookings",
      ] as const)
        expect(latest.tables.find((row) => row.table === table)!.rows).toEqual(
          after.tables.find((row) => row.table === table)!.rows,
        );
    }, historicalStart));

  it("includes new cancellation columns in a current-schema protection baseline", async () =>
    withDatabase(async (database, client) => {
      const bookingId = await existingBooking(client);
      const before = await captureChatSpacesAudit({}, database);
      expect(
        before.tables.find(({ table }) => table === "bookings")!.hashColumns,
      ).toEqual(expect.arrayContaining(["cancel_kind", "cancel_reason"]));
      await client.query(
        "update bookings set cancel_kind='operator',cancel_reason='changed-private-reason' where id=$1",
        [bookingId],
      );
      const after = await captureChatSpacesAudit(
        { baseline: before },
        database,
      );
      expect(() => compareChatSpacesAudit(before, after)).toThrow(
        "보호 데이터",
      );
      expect(JSON.stringify(after)).not.toContain("changed-private-reason");
    }));

  it("reports exact new row keys for a caller's independent additive whitelist", async () =>
    withDatabase(async (database, client) => {
      const before = await captureChatSpacesAudit({}, database);
      const id = crypto.randomUUID();
      await client.query(
        "insert into users(id,name,email) values($1,'추가 회원','added@example.test')",
        [id],
      );
      expect(
        compareChatSpacesAudit(
          before,
          await captureChatSpacesAudit({ baseline: before }, database),
        ).added,
      ).toEqual([{ table: "users", count: 1, keys: [JSON.stringify([id])] }]);
    }));

  it.each(["name", "password", "session"] as const)(
    "rejects changed %s values without returning them",
    async (field) =>
      withDatabase(async (database, client) => {
        const before = await captureChatSpacesAudit({}, database);
        if (field === "name")
          await client.query(
            "update users set name='changed-private-name' where id=$1",
            [userId],
          );
        if (field === "password")
          await client.exec(
            "update auth_accounts set password='changed-private-password'",
          );
        if (field === "session")
          await client.exec(
            "update auth_sessions set token='changed-private-token'",
          );
        const after = await captureChatSpacesAudit(
          { baseline: before },
          database,
        );
        expect(() => compareChatSpacesAudit(before, after)).toThrow(
          "보호 데이터",
        );
      }),
  );

  it("rejects missing rows", async () =>
    withDatabase(async (database, client) => {
      const before = await captureChatSpacesAudit({}, database);
      await client.exec("delete from auth_sessions");
      const after = await captureChatSpacesAudit(
        { baseline: before },
        database,
      );
      expect(() => compareChatSpacesAudit(before, after)).toThrow(
        "보호 데이터",
      );
    }));

  it("omits cursor fields only for the explicitly selected live branch text room", async () =>
    withDatabase(async (database, client) => {
      const { first, second } = await lounge(client);
      const before = await captureChatSpacesAudit(
        { loungeRoomId: first },
        database,
      );
      await client.query(
        "update chat_rooms set last_seq=9007199254740993,last_message_at='2026-10-09T03:00:00.123456Z' where id=$1",
        [first],
      );
      const after = await captureChatSpacesAudit(
        { baseline: before },
        database,
      );
      expect(compareChatSpacesAudit(before, after).added).toEqual([]);
      expect(await readChatSpacesLoungeCursor(first, database)).toEqual({
        lastSeq: "9007199254740993",
        lastMessageAt: "2026-10-09T03:00:00.123456Z",
      });
      await client.query("update chat_rooms set last_seq=1 where id=$1", [
        second,
      ]);
      const changed = await captureChatSpacesAudit(
        { baseline: before },
        database,
      );
      expect(() => compareChatSpacesAudit(before, changed)).toThrow(
        "보호 데이터",
      );
    }));

  it("still protects all noncursor fields of the selected room and forbids switching the exempt room", async () =>
    withDatabase(async (database, client) => {
      const { first, second } = await lounge(client);
      const before = await captureChatSpacesAudit(
        { loungeRoomId: first },
        database,
      );
      await expect(
        captureChatSpacesAudit(
          { baseline: before, loungeRoomId: second },
          database,
        ),
      ).rejects.toThrow("보호 데이터");
      await client.query(
        "update chat_rooms set topic='바뀐 주제' where id=$1",
        [first],
      );
      const after = await captureChatSpacesAudit(
        { baseline: before },
        database,
      );
      expect(() => compareChatSpacesAudit(before, after)).toThrow(
        "보호 데이터",
      );
      await expect(
        readChatSpacesLoungeCursor(crypto.randomUUID(), database),
      ).rejects.toThrow("보호 데이터");
    }));

  it("detects bigint and microsecond timestamp changes without JS precision loss", async () =>
    withDatabase(async (database, client) => {
      const { first } = await lounge(client);
      await client.query(
        "update chat_rooms set last_seq=9007199254740992,last_message_at='2026-10-09T03:00:00.123456Z' where id=$1",
        [first],
      );
      const before = await captureChatSpacesAudit({}, database);
      await client.query(
        "update chat_rooms set last_seq=9007199254740993 where id=$1",
        [first],
      );
      let changed = await captureChatSpacesAudit(
        { baseline: before },
        database,
      );
      expect(() => compareChatSpacesAudit(before, changed)).toThrow(
        "보호 데이터",
      );
      await client.query(
        "update chat_rooms set last_seq=9007199254740992,last_message_at='2026-10-09T03:00:00.123457Z' where id=$1",
        [first],
      );
      changed = await captureChatSpacesAudit({ baseline: before }, database);
      expect(() => compareChatSpacesAudit(before, changed)).toThrow(
        "보호 데이터",
      );
    }));

  it.each([
    "table",
    "view",
    "trigger",
    "external_fk",
    "missing_table",
    "missing_column",
    "wrong_pk",
  ] as const)("fails closed for %s catalog drift", async (kind) =>
    withDatabase(async (database, client) => {
      const before = await captureChatSpacesAudit({}, database);
      if (kind === "table")
        await client.exec(
          "create table public.unexpected_data(id int primary key)",
        );
      if (kind === "view")
        await client.exec(
          "create view public.unexpected_view as select id from users",
        );
      if (kind === "trigger")
        await client.exec(
          "create function public.audit_trigger() returns trigger language plpgsql as $$ begin return new; end; $$; create trigger audit_trigger before update on users for each row execute function public.audit_trigger()",
        );
      if (kind === "external_fk")
        await client.exec(
          "create schema external; create table external.ref(id uuid references public.users(id))",
        );
      if (kind === "missing_table")
        await client.exec("drop table auth_sessions");
      if (kind === "missing_column")
        await client.exec("alter table users drop column avatar_color");
      if (kind === "wrong_pk")
        await client.exec(
          "alter table auth_sessions drop constraint auth_sessions_pkey; alter table auth_sessions add primary key(token)",
        );
      await expect(
        captureChatSpacesAudit({ baseline: before }, database),
      ).rejects.toThrow("보호 데이터");
    }),
  );

  it.each(["hash", "time", "gap", "future"] as const)(
    "rejects %s migration journal corruption",
    async (kind) =>
      withDatabase(async (database, client) => {
        if (kind === "hash")
          await client.exec(
            "update drizzle.__drizzle_migrations set hash='unexpected' where id=4",
          );
        if (kind === "time")
          await client.exec(
            "update drizzle.__drizzle_migrations set created_at=created_at+1 where id=4",
          );
        if (kind === "gap")
          await client.exec(
            "delete from drizzle.__drizzle_migrations where id=4",
          );
        if (kind === "future")
          await client.exec(
            "insert into drizzle.__drizzle_migrations(hash,created_at) values('unknown',9999999999999)",
          );
        await expect(preflightChatSpacesMigrations(database)).rejects.toThrow(
          "마이그레이션 이력",
        );
        await expect(captureChatSpacesAudit({}, database)).rejects.toThrow(
          "보호 데이터",
        );
      }),
  );

  it("rejects an older-than-25 baseline and absent journal", async () =>
    withDatabase(async (database, client) => {
      await expect(preflightChatSpacesMigrations(database)).rejects.toThrow(
        "마이그레이션 이력",
      );
      await client.exec("drop table drizzle.__drizzle_migrations");
      await expect(preflightChatSpacesMigrations(database)).rejects.toThrow(
        "마이그레이션 이력",
      );
    }, 18));
});
