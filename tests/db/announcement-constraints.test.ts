import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  announcements,
  branches,
  chatRooms,
  chatSpaces,
  messages,
  users,
} from "@/lib/db/schema";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("51. announcement constraints from actual migrations", () => {
  let database: TestDatabase;
  const branchId = crypto.randomUUID();
  const authorId = crypto.randomUUID();
  const now = new Date("2026-10-09T03:00:00Z");
  const row = {
    branchId,
    authorId,
    title: "공지",
    body: "안내예요",
    createdAt: now,
  };
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    await database.db.execute(sql`truncate users, branches cascade`);
    await database.db
      .insert(users)
      .values({ id: authorId, name: "운영자", email: "operator@example.test" });
    await database.db.insert(branches).values({ id: branchId, name: "강남점" });
  });
  it.each([
    { title: "" },
    { title: "가".repeat(61) },
    { body: "" },
    { body: "가".repeat(501) },
    { title: "😀".repeat(61) },
  ])("rejects text outside the database bounds: %j", async (invalid) => {
    await expect(
      database.db.insert(announcements).values({ ...row, ...invalid }),
    ).rejects.toMatchObject({
      cause: { code: "23514", constraint: "announcements_text_length" },
    });
  });
  it("stores exact Unicode bounds, nullable targets, injected time, and default zero recipients", async () => {
    const [stored] = await database.db
      .insert(announcements)
      .values({ ...row, title: "😀".repeat(60), body: "😀".repeat(500) })
      .returning();
    expect(stored).toMatchObject({
      branchId,
      authorId,
      loungeMessageId: null,
      audience: null,
      recipientCount: 0,
      createdAt: now,
    });
  });
  it("preserves historical announcements after deleting the lounge message", async () => {
    const [space] = await database.db
      .insert(chatSpaces)
      .values({ kind: "branch", branchId })
      .returning();
    const [room] = await database.db
      .insert(chatRooms)
      .values({
        kind: "text",
        spaceId: space!.id,
        name: "공지",
        adminOnly: true,
      })
      .returning();
    const [message] = await database.db
      .insert(messages)
      .values({
        roomId: room!.id,
        seq: 1,
        authorId,
        kind: "text",
        body: "공지",
        clientId: crypto.randomUUID(),
      })
      .returning();
    const [notice] = await database.db
      .insert(announcements)
      .values({ ...row, loungeMessageId: message!.id })
      .returning();
    await database.db.delete(messages).where(eq(messages.id, message!.id));
    expect(await database.db.select().from(announcements)).toEqual([
      { ...notice, loungeMessageId: null },
    ]);
  });
  it("retains author and branch references and indexes branch-local history", async () => {
    await database.db.insert(announcements).values(row);
    await expect(
      database.db.delete(users).where(eq(users.id, authorId)),
    ).rejects.toMatchObject({ cause: { code: "23001" } });
    await expect(
      database.db.delete(branches).where(eq(branches.id, branchId)),
    ).rejects.toMatchObject({ cause: { code: "23001" } });
    const result = await database.db.execute(
      sql`select indexdef from pg_indexes where indexname = 'announcements_branch_created_idx'`,
    );
    expect(result.rows[0]?.indexdef).toContain("branch_id, created_at DESC");
  });
});
