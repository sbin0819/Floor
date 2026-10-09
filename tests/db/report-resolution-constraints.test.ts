import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chatRooms, messages, reports, users } from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("52. report resolution constraints from actual migrations", () => {
  let database: TestDatabase;
  const reporterId = crypto.randomUUID();
  const targetUserId = crypto.randomUUID();
  const resolvedBy = crypto.randomUUID();
  const resolvedAt = new Date("2026-10-09T03:00:00.123Z");
  const row = { reporterId, targetUserId, reason: "spam" as const };
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`truncate users cascade`);
    await database.db.insert(users).values(
      [reporterId, targetUserId, resolvedBy].map((id, index) => ({
        id,
        name: `가상 회원 ${index}`,
        email: `report-constraint-${index}@example.test`,
      })),
    );
  });
  it.each([
    { resolvedAt },
    { resolvedBy },
    { resolution: "dismissed" as const },
    { resolvedAt, resolvedBy },
    { resolvedAt, resolution: "dismissed" as const },
    { resolvedBy, resolution: "dismissed" as const },
  ])("rejects partial resolution on insert and update: %j", async (partial) => {
    const failure = {
      cause: { code: "23514", constraint: "reports_resolution_consistent" },
    };
    await expect(
      database.db.insert(reports).values({ ...row, ...partial }),
    ).rejects.toMatchObject(failure);
    const [unresolved] = await database.db
      .insert(reports)
      .values(row)
      .returning();
    await expect(
      database.db
        .update(reports)
        .set(partial)
        .where(eq(reports.id, unresolved!.id)),
    ).rejects.toMatchObject(failure);
    expect(await database.db.select().from(reports)).toEqual([unresolved]);
  });
  it("defaults all three fields to null without changing legacy reports", async () => {
    const [stored] = await database.db.insert(reports).values(row).returning();
    expect(stored).toMatchObject({
      ...row,
      resolvedAt: null,
      resolvedBy: null,
      resolution: null,
    });
  });
  it.each(["dismissed", "message_deleted", "member_banned"] as const)(
    "accepts a complete %s resolution with the exact supplied instant",
    async (resolution) => {
      const [stored] = await database.db
        .insert(reports)
        .values({
          ...row,
          resolvedAt,
          resolvedBy,
          resolution,
        })
        .returning();
      expect(stored).toMatchObject({
        ...row,
        resolvedAt,
        resolvedBy,
        resolution,
      });
    },
  );
  it("rejects a missing resolver and preserves the referenced resolver", async () => {
    await expect(
      database.db.insert(reports).values({
        ...row,
        resolvedAt,
        resolvedBy: crypto.randomUUID(),
        resolution: "dismissed",
      }),
    ).rejects.toMatchObject({
      cause: { code: "23503", constraint: "reports_resolved_by_users_id_fk" },
    });
    await database.db.insert(reports).values({
      ...row,
      resolvedAt,
      resolvedBy,
      resolution: "dismissed",
    });
    await expect(
      database.db.delete(users).where(eq(users.id, resolvedBy)),
    ).rejects.toMatchObject({ cause: { code: "23001" } });
  });
  it("retains resolution history when a referenced message is physically removed", async () => {
    const [room] = await database.db
      .insert(chatRooms)
      .values({ kind: "group_dm" })
      .returning();
    const [message] = await database.db
      .insert(messages)
      .values({
        roomId: room!.id,
        seq: 1,
        authorId: targetUserId,
        body: "기록을 보존해요",
      })
      .returning();
    const [stored] = await database.db
      .insert(reports)
      .values({
        ...row,
        messageId: message!.id,
        resolvedAt,
        resolvedBy,
        resolution: "message_deleted",
      })
      .returning();
    await database.db.delete(messages).where(eq(messages.id, message!.id));
    expect(await database.db.select().from(reports)).toEqual([
      { ...stored, messageId: null },
    ]);
  });
  it("indexes only unresolved message reports and defines exactly the three resolutions", async () => {
    const index = await database.client.query<{ indexdef: string }>(
      "select indexdef from pg_indexes where schemaname='public' and indexname='reports_open_message_idx'",
    );
    expect(index.rows).toHaveLength(1);
    expect(index.rows[0]!.indexdef).toContain("USING btree (message_id)");
    expect(index.rows[0]!.indexdef).toMatch(
      /WHERE.*resolved_at IS NULL.*AND.*message_id IS NOT NULL/u,
    );
    const values = await database.client.query<{ enumlabel: string }>(
      "select e.enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='report_resolution' order by e.enumsortorder",
    );
    expect(values.rows.map(({ enumlabel }) => enumlabel)).toEqual([
      "dismissed",
      "message_deleted",
      "member_banned",
    ]);
  });
});
