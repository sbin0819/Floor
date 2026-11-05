import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAuth, type AuthInstance } from "@/lib/auth/auth";
import { listDirectNav } from "@/lib/dal/direct";
import {
  authAccounts,
  branchStaff,
  chatRoomMembers,
  chatRoomReads,
  chatRooms,
  messages,
  teamMembers,
  teams,
  users,
} from "@/lib/db/schema";
import { createMemoryEmailSender } from "@/lib/email/memory";
import { loadSeedData } from "@/lib/seed/data";
import { loadSeedPeople } from "@/lib/seed/people";
import { runSeed } from "@/lib/seed/run-seed";
import { createTestDatabase, type TestDatabase } from "./helper";

const source = loadSeedData();
const people = loadSeedPeople(source);
const now = new Date("2026-11-05T05:00:00Z");

describe("the canonical 21 development seed accounts", () => {
  let database: TestDatabase;
  let auth: AuthInstance;
  let accounts: (typeof users.$inferSelect)[];
  beforeAll(async () => {
    database = await createTestDatabase();
    auth = createAuth({
      db: database.db,
      email: createMemoryEmailSender(),
      secret: "seed-account-integrity-secret-at-least-32-bytes",
      baseUrl: "http://localhost:3000",
      rateLimit: { enabled: false },
    });
    await runSeed({ db: database.db, auth, now, resetPasswords: false });
    accounts = await database.db.select().from(users);
  });
  afterAll(async () => {
    await database?.client.close();
  });

  function account(key: string) {
    const email = source.users.find((row) => row.key === key)!.email;
    return accounts.find((row) => row.email === email)!;
  }

  it("creates exactly the Korean-named administrator and test1 through test20 with independently salted credentials and default branches", async () => {
    expect(source.users.map(({ email }) => email)).toEqual([
      "admin@ai.com",
      ...Array.from({ length: 20 }, (_, index) => `test${index + 1}@ai.com`),
    ]);
    expect(accounts).toHaveLength(21);
    const credentials = await database.db.select().from(authAccounts);
    expect(credentials).toHaveLength(21);
    const context = await auth.$context;
    for (const row of source.users) {
      expect(row.password).toBe("qwer1234");
      expect(row.name).toMatch(/^[가-힣]{3}$/u);
      const user = account(row.key);
      expect(user).toMatchObject({
        name: row.name,
        emailVerified: true,
        defaultBranchId: row.defaultBranchId,
      });
      const credential = credentials.find(({ userId }) => userId === user.id)!;
      expect(credential.providerId).toBe("credential");
      expect(credential.password).not.toBe(row.password);
      expect(
        await context.password.verify({
          hash: credential.password!,
          password: row.password,
        }),
      ).toBe(true);
    }
    expect(new Set(credentials.map(({ password }) => password)).size).toBe(21);
  });

  it("preserves the scenario identities, four teams with one admin each and a single operator", async () => {
    expect(
      source.users
        .slice(0, 6)
        .map(({ key, email, name }) => ({ key, email, name })),
    ).toEqual([
      { key: "admin", email: "admin@ai.com", name: "김도윤" },
      { key: "member", email: "test1@ai.com", name: "김하은" },
      { key: "designAdmin", email: "test2@ai.com", name: "박지훈" },
      { key: "designMember", email: "test3@ai.com", name: "이서연" },
      { key: "growthAdmin", email: "test4@ai.com", name: "최민준" },
      { key: "both", email: "test5@ai.com", name: "정유나" },
    ]);
    const teamRows = await database.db.select().from(teams);
    expect(teamRows.map(({ name }) => name).sort()).toEqual([
      "그로스팀",
      "데브팀",
      "디자인팀",
      "마케팅팀",
    ]);
    const members = await database.db.select().from(teamMembers);
    expect(members).toHaveLength(source.teamMembers.length);
    for (const row of source.teamMembers) {
      expect(members).toContainEqual(
        expect.objectContaining({
          teamId: row.teamId,
          userId: account(row.userKey).id,
          role: row.role,
          title: row.title,
        }),
      );
    }
    for (const team of teamRows)
      expect(
        members.filter((row) => row.teamId === team.id && row.role === "admin"),
      ).toHaveLength(1);
    // 김하은은 팀이 없는 일반 회원으로 남는다 (시작 안내 데모).
    expect(members.some(({ userId }) => userId === account("member").id)).toBe(
      false,
    );
    const staff = await database.db.select().from(branchStaff);
    expect(staff).toHaveLength(5);
    expect(new Set(staff.map(({ userId }) => userId))).toEqual(
      new Set([account("admin").id]),
    );
    expect(staff.map(({ branchId }) => branchId).sort()).toEqual(
      source.branches.map(({ id }) => id).sort(),
    );
    // 운영자는 사용자 이름을 처음 정하는 화면을 보기 위해 비워 둔다.
    expect(account("admin").username).toBeNull();
    for (const { userKey, username } of people.usernames)
      expect(account(userKey).username).toBe(username);
  });

  it("keeps room sequences, read cursors and group join times coherent and preserves Ha-eun's unread DM", async () => {
    const rooms = await database.db.select().from(chatRooms);
    const rows = await database.db.select().from(messages);
    const reads = await database.db.select().from(chatRoomReads);
    const members = await database.db.select().from(chatRoomMembers);
    for (const room of rooms) {
      const conversation = rows
        .filter(({ roomId }) => roomId === room.id)
        .sort((a, b) => a.seq - b.seq);
      expect(conversation.map(({ seq }) => seq)).toEqual(
        Array.from({ length: room.lastSeq }, (_, index) => index + 1),
      );
      expect(room.lastMessageAt).toEqual(
        conversation.at(-1)?.createdAt ?? null,
      );
      for (const read of reads.filter(({ roomId }) => roomId === room.id)) {
        expect(read.lastReadSeq).toBeGreaterThanOrEqual(0);
        expect(read.lastReadSeq).toBeLessThanOrEqual(room.lastSeq);
      }
      if (room.kind === "dm" || room.kind === "group_dm") {
        const memberships = members.filter(({ roomId }) => roomId === room.id);
        if (room.kind === "dm") expect(memberships).toHaveLength(2);
        else expect(memberships.length).toBeGreaterThanOrEqual(3);
        for (const row of conversation) {
          expect(
            memberships.every(({ joinedAt }) => joinedAt <= row.createdAt),
          ).toBe(true);
          if (row.authorId !== null)
            expect(
              memberships.some(({ userId }) => userId === row.authorId),
            ).toBe(true);
        }
        if (room.kind === "group_dm") {
          expect(conversation[0]).toMatchObject({
            kind: "system",
            seq: 1,
            systemData: { type: "group_created" },
          });
          expect(
            memberships.every(
              ({ joinedAt }) =>
                joinedAt.getTime() === conversation[0]!.createdAt.getTime(),
            ),
          ).toBe(true);
        }
      }
    }
    const haEun = account("member");
    const seoyeon = account("designMember");
    const [direct] = await listDirectNav(haEun.id, database.db);
    expect(direct).toMatchObject({
      kind: "dm",
      lastSeq: 3,
      unreadCount: 1,
      other: { userId: seoyeon.id },
    });
    expect(
      reads.find(
        ({ roomId, userId }) =>
          roomId === direct!.roomId && userId === haEun.id,
      ),
    ).toMatchObject({ lastReadSeq: 2 });
  });
});
