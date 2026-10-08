import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";

describe("chat foundation migration", () => {
  it("replaces the unused legacy tables and backfills one general channel per existing team", async () => {
    const client = new PGlite({ extensions: { btree_gist } });
    try {
      const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
      const removalIndex = migrations.findIndex(({ sql }) =>
        sql.some((statement) =>
          statement.includes('DROP TABLE "call_sessions"'),
        ),
      );
      expect(removalIndex).toBeGreaterThan(0);
      const foundationIndex = migrations.findIndex(({ sql }) =>
        sql.some((statement) =>
          statement.includes('CREATE TABLE "chat_spaces"'),
        ),
      );
      expect(foundationIndex).toBeGreaterThan(removalIndex);
      const apply = async (entries: typeof migrations) => {
        for (const migration of entries) {
          await client.transaction(async (transaction) => {
            for (const statement of migration.sql)
              await transaction.exec(statement);
          });
        }
      };
      await apply(migrations.slice(0, removalIndex));
      const userId = crypto.randomUUID();
      const firstTeamId = crypto.randomUUID();
      const secondTeamId = crypto.randomUUID();
      await client.query(
        "INSERT INTO users (id, name, email) VALUES ($1, $2, $3)",
        [userId, "기존 회원", "chat-upgrade@example.test"],
      );
      await client.query(
        "INSERT INTO teams (id, name, created_by) VALUES ($1, $2, $3), ($4, $5, $3)",
        [firstTeamId, "기존 디자인팀", userId, secondTeamId, "기존 개발팀"],
      );
      await apply(migrations.slice(removalIndex, removalIndex + 1));
      const legacy = await client.query<{ table_name: string | null }>(
        "SELECT to_regclass('public.call_sessions')::text AS table_name",
      );
      expect(legacy.rows).toEqual([{ table_name: null }]);
      await apply(migrations.slice(removalIndex + 1, foundationIndex + 1));

      const spaces = await client.query<{
        team_id: string;
        kind: string;
        name: string | null;
      }>("SELECT team_id, kind, name FROM chat_spaces ORDER BY team_id");
      expect(spaces.rows).toEqual(
        [firstTeamId, secondTeamId]
          .sort()
          .map((teamId) => ({ team_id: teamId, kind: "team", name: null })),
      );
      const rooms = await client.query<{
        team_id: string;
        kind: string;
        name: string;
        last_seq: number;
      }>(
        "SELECT s.team_id, r.kind, r.name, r.last_seq::int FROM chat_rooms r JOIN chat_spaces s ON s.id = r.space_id ORDER BY s.team_id",
      );
      expect(rooms.rows).toEqual(
        [firstTeamId, secondTeamId].sort().map((teamId) => ({
          team_id: teamId,
          kind: "text",
          name: "일반",
          last_seq: 0,
        })),
      );
      const kinds = await client.query<{ kind: string }>(
        "SELECT unnest(enum_range(NULL::chat_room_kind))::text AS kind",
      );
      expect(kinds.rows.map(({ kind }) => kind)).toEqual([
        "text",
        "voice",
        "dm",
        "group_dm",
        "meeting",
      ]);
      const columns = await client.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'messages'",
      );
      expect(columns.rows.map(({ column_name }) => column_name)).not.toContain(
        "space_ref",
      );
      await apply(migrations.slice(foundationIndex + 1));
      expect(
        (
          await client.query(
            "SELECT to_regclass('public.call_sessions')::text AS table_name",
          )
        ).rows,
      ).toEqual([{ table_name: "call_sessions" }]);
    } finally {
      await client.close();
    }
  });
});
