import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { describe, expect, it } from "vitest";

describe("meeting channel backfill", () => {
  it("creates only recent confirmed time rooms and fills existing participant timestamps", async () => {
    const client = new PGlite({ extensions: { btree_gist } });
    try {
      const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
      const index = migrations.findIndex(({ sql }) =>
        sql.some((statement) =>
          statement.includes(
            'ALTER TABLE "chat_rooms" ADD COLUMN "booking_id"',
          ),
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
      const guest = crypto.randomUUID();
      const branch = crypto.randomUUID();
      const floor = crypto.randomUUID();
      await client.query(
        "INSERT INTO users (id,name,email) VALUES ($1,'예약자','booker@meeting.test'),($2,'참석자','guest@meeting.test')",
        [owner, guest],
      );
      await client.query(
        "INSERT INTO branches (id,name) VALUES ($1,'가상 지점')",
        [branch],
      );
      await client.query(
        "INSERT INTO floors (id,branch_id,level,name) VALUES ($1,$2,1,'1F')",
        [floor, branch],
      );
      const rows = [
        {
          label: "future",
          type: "meeting_room",
          start: 24,
          end: 25,
          status: "confirmed",
        },
        {
          label: "ongoing",
          type: "meeting_room",
          start: -1,
          end: 1,
          status: "confirmed",
        },
        {
          label: "recent",
          type: "meeting_room",
          start: -21,
          end: -20,
          status: "confirmed",
        },
        {
          label: "old",
          type: "meeting_room",
          start: -31,
          end: -30,
          status: "confirmed",
        },
        {
          label: "cancelled",
          type: "meeting_room",
          start: 24,
          end: 25,
          status: "cancelled",
        },
        {
          label: "desk",
          type: "desk",
          start: 24,
          end: 25,
          status: "confirmed",
        },
        {
          label: "phone",
          type: "phone_booth",
          start: 24,
          end: 25,
          status: "confirmed",
        },
        {
          label: "lounge",
          type: "lounge",
          start: 24,
          end: 25,
          status: "confirmed",
        },
      ].map((row) => ({
        ...row,
        id: crypto.randomUUID(),
        spaceId: crypto.randomUUID(),
      }));
      for (const row of rows) {
        await client.query(
          "INSERT INTO spaces (id,floor_id,type,name) VALUES ($1,$2,$3,$4)",
          [row.spaceId, floor, row.type, row.label],
        );
        await client.query(
          "INSERT INTO bookings (id,space_id,user_id,during,status,cancelled_at) VALUES ($1,$2,$3,tstzrange(now()+$4*interval '1 hour',now()+$5*interval '1 hour','[)'),$6::booking_status,CASE WHEN $6::booking_status='cancelled' THEN now() ELSE NULL END)",
          [row.id, row.spaceId, owner, row.start, row.end, row.status],
        );
      }
      await client.query(
        "INSERT INTO booking_participants (booking_id,user_id) VALUES ($1,$2)",
        [rows[0]!.id, guest],
      );
      const before = new Date();
      await apply(migrations.slice(index));
      const after = new Date();
      const result = await client.query<{
        title: string;
        last_seq: number;
        name: null;
      }>(
        "SELECT s.name AS title,r.last_seq::int,r.name FROM chat_rooms r JOIN bookings b ON b.id=r.booking_id JOIN spaces s ON s.id=b.space_id ORDER BY s.name",
      );
      expect(result.rows).toEqual(
        ["future", "lounge", "ongoing", "phone", "recent"].map((title) => ({
          title,
          last_seq: 0,
          name: null,
        })),
      );
      const participants = await client.query<{ created_at: Date }>(
        "SELECT created_at FROM booking_participants",
      );
      expect(participants.rows[0]!.created_at.getTime()).toBeGreaterThanOrEqual(
        before.getTime(),
      );
      expect(participants.rows[0]!.created_at.getTime()).toBeLessThanOrEqual(
        after.getTime(),
      );
      expect((await client.query("SELECT id FROM messages")).rows).toEqual([]);
      const backfill = migrations[index]!.sql.find((statement) =>
        statement.includes('INSERT INTO "chat_rooms"'),
      )!;
      await client.exec(backfill);
      expect(
        (await client.query("SELECT id FROM chat_rooms")).rows,
      ).toHaveLength(5);
    } finally {
      await client.close();
    }
  });
});
