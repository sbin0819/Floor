import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { eq, sql } from "drizzle-orm";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createBranch } from "@/lib/dal/branches";
import { createBranchLounge, createTeamSpace } from "@/lib/dal/chat-write";
import { chatRooms, chatSpaces, teams, users } from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("branch lounge provisioning", () => {
  let database: TestDatabase;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`TRUNCATE users, branches CASCADE`);
  });

  it("creates lounge text and voice channels atomically and preserves renamed/archived defaults", async () => {
    const branch = await database.db.transaction((tx) =>
      createBranch("새 지점", tx),
    );
    const lounge = await database.db.transaction((tx) =>
      createBranchLounge(branch.id, tx),
    );
    const rooms = await database.db
      .select()
      .from(chatRooms)
      .orderBy(chatRooms.name);
    expect(
      rooms.map(({ name, kind, adminOnly, voiceCapacity }) => ({
        name,
        kind,
        adminOnly,
        voiceCapacity,
      })),
    ).toEqual([
      { name: "공지", kind: "text", adminOnly: true, voiceCapacity: null },
      { name: "라운지", kind: "text", adminOnly: false, voiceCapacity: null },
      {
        name: "라운지-음성",
        kind: "voice",
        adminOnly: false,
        voiceCapacity: 10,
      },
    ]);
    expect(await database.db.select().from(chatSpaces)).toHaveLength(1);
    await database.db
      .update(chatRooms)
      .set({ archivedAt: new Date("2026-10-09T00:00:00Z") })
      .where(eq(chatRooms.id, rooms[0]!.id));
    await database.db
      .update(chatRooms)
      .set({ name: "기존 대화방" })
      .where(eq(chatRooms.id, rooms[1]!.id));
    const before = await database.db
      .select()
      .from(chatRooms)
      .orderBy(chatRooms.id);
    expect(
      await database.db.transaction((tx) => createBranchLounge(branch.id, tx)),
    ).toEqual(lounge);
    expect(
      await database.db.select().from(chatRooms).orderBy(chatRooms.id),
    ).toEqual(before);
    const voice = rooms.find(({ kind }) => kind === "voice")!;
    await database.db.delete(chatRooms).where(eq(chatRooms.id, voice.id));
    await database.db.transaction((tx) => createBranchLounge(branch.id, tx));
    expect(await database.db.select().from(chatRooms)).toHaveLength(2);
  });

  it("does not recreate a renamed, archived, or removed team default channel", async () => {
    const [user] = await database.db
      .insert(users)
      .values({ name: "팀 소유자", email: "owner@example.test" })
      .returning();
    const [team] = await database.db
      .insert(teams)
      .values({ name: "검사 팀", createdBy: user!.id })
      .returning();
    const first = await database.db.transaction((tx) =>
      createTeamSpace(team!.id, tx),
    );
    if (!first.roomId) throw new Error("Expected a new default channel.");
    const [voice] = await database.db
      .select()
      .from(chatRooms)
      .where(eq(chatRooms.kind, "voice"));
    expect(voice).toMatchObject({
      spaceId: first.spaceId,
      name: "회의실",
      voiceCapacity: 10,
    });
    await database.db
      .update(chatRooms)
      .set({ archivedAt: new Date("2026-10-09T00:00:00Z") })
      .where(eq(chatRooms.id, first.roomId));
    expect(
      await database.db.transaction((tx) => createTeamSpace(team!.id, tx)),
    ).toEqual(first);
    await database.db
      .update(chatRooms)
      .set({ name: "이름 변경됨" })
      .where(eq(chatRooms.id, first.roomId));
    expect(
      await database.db.transaction((tx) => createTeamSpace(team!.id, tx)),
    ).toEqual({ spaceId: first.spaceId, roomId: null });
    expect(await database.db.select().from(chatRooms)).toHaveLength(2);
    await database.db.delete(chatRooms).where(eq(chatRooms.id, first.roomId));
    expect(
      await database.db.transaction((tx) => createTeamSpace(team!.id, tx)),
    ).toEqual({ spaceId: first.spaceId, roomId: null });
    expect(await database.db.select().from(chatRooms)).toEqual([voice]);
    await database.db.delete(chatRooms).where(eq(chatRooms.id, voice!.id));
    await database.db.transaction((tx) => createTeamSpace(team!.id, tx));
    expect(await database.db.select().from(chatRooms)).toEqual([]);
  });
});

describe("branch lounge migration", () => {
  it("backfills only new lounges and preserves all existing channel state", async () => {
    const client = new PGlite({ extensions: { btree_gist } });
    try {
      const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
      const index = migrations.findIndex(({ sql }) =>
        sql.some((statement) =>
          statement.includes('CREATE TABLE "chat_space_members"'),
        ),
      );
      expect(index).toBeGreaterThan(0);
      const apply = async (entries: typeof migrations) => {
        for (const migration of entries)
          await client.transaction(async (tx) => {
            for (const statement of migration.sql) await tx.exec(statement);
          });
      };
      await apply(migrations.slice(0, index));
      const ids = [
        crypto.randomUUID(),
        crypto.randomUUID(),
        crypto.randomUUID(),
      ];
      for (const id of ids)
        await client.query("INSERT INTO branches (id, name) VALUES ($1, $2)", [
          id,
          `지점 ${id}`,
        ]);
      const existing = crypto.randomUUID();
      await client.query(
        "INSERT INTO chat_spaces (id, kind, branch_id) VALUES ($1, 'branch', $2)",
        [existing, ids[2]],
      );
      await client.query(
        "INSERT INTO chat_rooms (kind, space_id, name, admin_only, archived_at) VALUES ('text', $1, '이름 변경 공지', true, $2)",
        [existing, new Date("2026-10-09T00:00:00Z")],
      );
      const before = await client.query(
        "SELECT * FROM chat_rooms WHERE space_id = $1",
        [existing],
      );
      await apply(migrations.slice(index, index + 1));
      const spaces = await client.query(
        "SELECT branch_id, icon_color FROM chat_spaces WHERE kind = 'branch' ORDER BY branch_id",
      );
      expect(spaces.rows).toEqual(
        ids.toSorted().map((branch_id) => ({ branch_id, icon_color: "blue" })),
      );
      expect(
        (
          await client.query("SELECT * FROM chat_rooms WHERE space_id = $1", [
            existing,
          ])
        ).rows,
      ).toEqual(before.rows);
      const added = await client.query<{
        branch_id: string;
        name: string;
        kind: string;
        admin_only: boolean;
      }>(
        "SELECT s.branch_id, r.name, r.kind, r.admin_only FROM chat_rooms r JOIN chat_spaces s ON s.id = r.space_id WHERE s.id <> $1 ORDER BY s.branch_id, r.name",
        [existing],
      );
      expect(added.rows).toEqual(
        ids
          .slice(0, 2)
          .sort()
          .flatMap((branch_id) => [
            { branch_id, name: "공지", kind: "text", admin_only: true },
            { branch_id, name: "라운지", kind: "text", admin_only: false },
          ]),
      );
      await apply(migrations.slice(index + 1));
      expect(
        (await client.query("SELECT id FROM chat_rooms WHERE kind = 'voice'"))
          .rows,
      ).toHaveLength(3);
    } finally {
      await client.close();
    }
  });
});
