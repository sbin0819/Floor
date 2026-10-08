import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";

describe("nullable booking edit timestamp upgrade", () => {
  it("preserves old reservations and defaults new reservations to null", async () => {
    const client = new PGlite({ extensions: { btree_gist } });
    try {
      const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
      const upgradeIndex = migrations.findIndex(({ sql }) =>
        sql.some((statement) =>
          statement.includes('ALTER TABLE "bookings" ADD COLUMN "updated_at"'),
        ),
      );
      expect(upgradeIndex).toBeGreaterThan(0);
      for (const migration of migrations.slice(0, upgradeIndex))
        for (const statement of migration.sql) await client.exec(statement);

      const userId = crypto.randomUUID();
      const branchId = crypto.randomUUID();
      const floorId = crypto.randomUUID();
      const spaceId = crypto.randomUUID();
      const legacyId = crypto.randomUUID();
      await client.query(
        "INSERT INTO users (id, name, email) VALUES ($1, '기존 예약자', 'booking-edit@example.test')",
        [userId],
      );
      await client.query(
        "INSERT INTO branches (id, name) VALUES ($1, '가상 지점')",
        [branchId],
      );
      await client.query(
        "INSERT INTO floors (id, branch_id, level, name) VALUES ($1, $2, 1, '1F')",
        [floorId, branchId],
      );
      await client.query(
        "INSERT INTO spaces (id, floor_id, type, name) VALUES ($1, $2, 'meeting_room', '가상 회의실')",
        [spaceId, floorId],
      );
      await client.query(
        "INSERT INTO bookings (id, space_id, user_id, during, title, attendee_count) VALUES ($1, $2, $3, '[2026-10-09 01:00Z,2026-10-09 02:00Z)', '기존 제목', 3)",
        [legacyId, spaceId, userId],
      );
      const before = await client.query<{ data: Record<string, unknown> }>(
        "SELECT to_jsonb(b) AS data FROM bookings b WHERE id = $1",
        [legacyId],
      );
      for (const migration of migrations.slice(upgradeIndex))
        for (const statement of migration.sql) await client.exec(statement);
      const after = await client.query<{ data: Record<string, unknown> }>(
        "SELECT to_jsonb(b) AS data FROM bookings b WHERE id = $1",
        [legacyId],
      );
      expect(after.rows[0]?.data).toEqual({
        ...before.rows[0]?.data,
        updated_at: null,
      });
      const inserted = await client.query<{ updated_at: Date | null }>(
        "INSERT INTO bookings (space_id, user_id, during) VALUES ($1, $2, '[2026-10-09 02:00Z,2026-10-09 03:00Z)') RETURNING updated_at",
        [spaceId, userId],
      );
      expect(inserted.rows).toEqual([{ updated_at: null }]);
      const column = await client.query<{
        is_nullable: string;
        column_default: string | null;
        data_type: string;
      }>(
        "SELECT is_nullable, column_default, data_type FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'updated_at'",
      );
      expect(column.rows).toEqual([
        {
          is_nullable: "YES",
          column_default: null,
          data_type: "timestamp with time zone",
        },
      ]);
    } finally {
      await client.close();
    }
  });
});
