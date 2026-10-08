import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";

describe("voice channel and call migration", () => {
  it("preserves existing voice rows and only backfills eligible spaces once", async () => {
    const client = new PGlite({ extensions: { btree_gist } });
    try {
      const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
      const index = migrations.findIndex(({ sql }) =>
        sql.some((statement) =>
          statement.includes('ADD COLUMN "voice_capacity"'),
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
      const owner = crypto.randomUUID();
      await client.query(
        "INSERT INTO users (id,name,email) VALUES ($1,'김하은','migration-call@example.test')",
        [owner],
      );
      const team = crypto.randomUUID();
      const branch = crypto.randomUUID();
      await client.query(
        "INSERT INTO teams (id,name,created_by) VALUES ($1,'가상 팀',$2)",
        [team, owner],
      );
      await client.query(
        "INSERT INTO branches (id,name) VALUES ($1,'가상 지점')",
        [branch],
      );
      const ids = Object.fromEntries(
        [
          "team",
          "branch",
          "community",
          "existing",
          "archived",
          "conflict",
          "archived-name",
          "deleted",
        ].map((key) => [key, crypto.randomUUID()]),
      );
      await client.query(
        "INSERT INTO chat_spaces (id,kind,team_id) VALUES ($1,'team',$2)",
        [ids.team, team],
      );
      await client.query(
        "INSERT INTO chat_spaces (id,kind,branch_id) VALUES ($1,'branch',$2)",
        [ids.branch, branch],
      );
      for (const key of [
        "community",
        "existing",
        "archived",
        "conflict",
        "archived-name",
        "deleted",
      ]) {
        await client.query(
          "INSERT INTO chat_spaces (id,kind,name,created_by,deleted_at) VALUES ($1,'community',$2,$3,$4)",
          [
            ids[key],
            key,
            owner,
            key === "deleted" ? new Date("2026-10-01T00:00:00Z") : null,
          ],
        );
      }
      const existingRoom = crypto.randomUUID();
      const archivedRoom = crypto.randomUUID();
      const archivedAt = new Date("2026-10-02T01:00:00Z");
      await client.query(
        "INSERT INTO chat_rooms (id,kind,space_id,name,archived_at,last_seq) VALUES ($1,'voice',$2,'바꾼 음성 이름',NULL,7),($3,'voice',$4,'보관한 음성',$5,5)",
        [existingRoom, ids.existing, archivedRoom, ids.archived, archivedAt],
      );
      await client.query(
        "INSERT INTO chat_rooms (kind,space_id,name,archived_at) VALUES ('text',$1,'음성',NULL),('text',$2,'음성',$3)",
        [ids.conflict, ids["archived-name"], archivedAt],
      );
      const before = await client.query(
        "SELECT id,space_id,name,archived_at,last_seq FROM chat_rooms WHERE kind='voice' ORDER BY id",
      );
      await apply(migrations.slice(index));
      expect(
        (
          await client.query(
            "SELECT id,space_id,name,archived_at,last_seq FROM chat_rooms WHERE id IN ($1,$2) ORDER BY id",
            [existingRoom, archivedRoom],
          )
        ).rows,
      ).toEqual(before.rows);
      expect(
        (
          await client.query(
            "SELECT voice_capacity FROM chat_rooms WHERE id IN ($1,$2)",
            [existingRoom, archivedRoom],
          )
        ).rows,
      ).toEqual([{ voice_capacity: 10 }, { voice_capacity: 10 }]);
      const result = await client.query<{
        space_id: string;
        name: string;
        voice_capacity: number;
      }>(
        "SELECT space_id,name,voice_capacity FROM chat_rooms WHERE kind='voice' ORDER BY space_id",
      );
      expect(result.rows).toHaveLength(6);
      for (const [key, name] of [
        ["team", "회의실"],
        ["branch", "라운지-음성"],
        ["community", "음성"],
        ["archived-name", "음성"],
      ]) {
        expect(result.rows).toContainEqual({
          space_id: ids[key!],
          name,
          voice_capacity: 10,
        });
      }
      for (const key of ["conflict", "deleted"])
        expect(result.rows.some((row) => row.space_id === ids[key])).toBe(
          false,
        );
      const backfill = migrations[index]!.sql.find((statement) =>
        statement.includes('INSERT INTO "chat_rooms"'),
      )!;
      const allBefore = (
        await client.query("SELECT * FROM chat_rooms ORDER BY id")
      ).rows;
      await client.exec(backfill);
      expect(
        (await client.query("SELECT * FROM chat_rooms ORDER BY id")).rows,
      ).toEqual(allBefore);
      expect((await client.query("SELECT * FROM call_sessions")).rows).toEqual(
        [],
      );
      expect(
        (await client.query("SELECT * FROM call_participants")).rows,
      ).toEqual([]);
    } finally {
      await client.close();
    }
  });
});
