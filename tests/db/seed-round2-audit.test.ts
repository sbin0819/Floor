import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import bookingRound2 from "@/docs/spec/examples/seed-bookings-2.json";
import {
  captureSeedRound2Audit,
  compareSeedRound2Audit,
  readSeedRound2MigrationHistory,
  validateSeedRound2Prerequisites,
} from "@/lib/dal/seed-round2-audit";
import {
  announcements,
  authAccounts,
  authSessions,
  authVerifications,
  bookingParticipants,
  bookings,
  branches,
  callParticipants,
  callSessions,
  chatRooms,
  chatSpaces,
  chatSpaceMembers,
  chatSpaceInvites,
  messages,
  messageAttachments,
  floors,
  notifications,
  reports,
  roleSettings,
  teamMembers,
  teams,
  users,
  spaces,
  spaceBlocks,
} from "@/lib/db/schema";
import { loadSeedData } from "@/lib/seed/data";
import {
  bookingNow,
  bookingRange,
  insertFixtureBooking,
  seedBookingActors,
  type BookingActors,
} from "./booking-helper";
import { createTestDatabase, type TestDatabase } from "./helper";

describe("read-only booking round2 preservation audit", () => {
  let database: TestDatabase;
  let actors: BookingActors;
  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.client.close();
  });
  beforeEach(async () => {
    actors = await seedBookingActors(database);
    await database.db.delete(authVerifications);
  });
  const capture = (allowSeedAttendeeCounts = false) =>
    captureSeedRound2Audit({ allowSeedAttendeeCounts }, database.db);

  it.each(["resolvedAt", "resolvedBy", "resolution"] as const)(
    "protects report %s without exposing the private report detail",
    async (field) => {
      const [report] = await database.db
        .insert(reports)
        .values({
          reporterId: actors.person.userId,
          targetUserId: actors.member.userId,
          reason: "other",
          detail: "private-report-detail",
          resolvedAt: bookingNow,
          resolvedBy: actors.operator.userId,
          resolution: "dismissed",
        })
        .returning();
      const before = await capture();
      expect(before.tables).toHaveLength(37);
      expect(JSON.stringify(before)).not.toContain("private-report-detail");
      if (field === "resolvedAt")
        await database.db.execute(
          sql`update reports set resolved_at=resolved_at+interval '1 microsecond' where id=${report!.id}::uuid`,
        );
      else
        await database.db
          .update(reports)
          .set(
            field === "resolvedBy"
              ? { resolvedBy: actors.otherOperator.userId }
              : { resolution: "message_deleted" },
          )
          .where(eq(reports.id, report!.id));
      expect(compareSeedRound2Audit(before, await capture()).issues).toEqual([
        {
          table: "reports",
          key: JSON.stringify([report!.id]),
          kind: "changed_row",
        },
      ]);
      await database.db.delete(reports).where(eq(reports.id, report!.id));
      expect(compareSeedRound2Audit(before, await capture()).issues).toEqual([
        {
          table: "reports",
          key: JSON.stringify([report!.id]),
          kind: "missing_row",
        },
      ]);
    },
  );

  it("detects changed and removed announcements without exposing snapshots", async () => {
    const [notice] = await database.db
      .insert(announcements)
      .values({
        branchId: actors.branchId,
        authorId: actors.operator.userId,
        title: "private-announcement-title",
        body: "private-announcement-body",
        createdAt: bookingNow,
      })
      .returning({ id: announcements.id });
    const before = await capture();
    expect(JSON.stringify(before)).not.toContain("private-announcement");
    await database.db
      .update(announcements)
      .set({ recipientCount: 3 })
      .where(eq(announcements.id, notice!.id));
    expect(compareSeedRound2Audit(before, await capture()).issues).toEqual([
      {
        table: "announcements",
        key: JSON.stringify([notice!.id]),
        kind: "changed_row",
      },
    ]);
    await database.db
      .delete(announcements)
      .where(eq(announcements.id, notice!.id));
    expect(compareSeedRound2Audit(before, await capture()).issues).toEqual([
      {
        table: "announcements",
        key: JSON.stringify([notice!.id]),
        kind: "missing_row",
      },
    ]);
  });

  it("detects changed and removed attachments without exposing storage keys or filenames", async () => {
    const [space] = await database.db
      .insert(chatSpaces)
      .values({
        kind: "team",
        teamId: actors.teamId,
      })
      .returning();
    const [room] = await database.db
      .insert(chatRooms)
      .values({
        kind: "text",
        name: "일반",
        spaceId: space!.id,
      })
      .returning();
    const [message] = await database.db
      .insert(messages)
      .values({
        roomId: room!.id,
        seq: 1,
        authorId: actors.person.userId,
        body: "",
      })
      .returning();
    const base = {
      roomId: room!.id,
      uploaderId: actors.person.userId,
      name: "private-original-filename.txt",
      contentType: "application/octet-stream",
      size: 10,
    };
    const [attached, pending] = await database.db
      .insert(messageAttachments)
      .values([
        {
          ...base,
          messageId: message!.id,
          position: 0,
          uploadedAt: bookingNow,
          storageKey: "private-attached-storage-key",
        },
        { ...base, storageKey: "private-pending-storage-key" },
      ])
      .returning();
    const before = await capture();
    expect(JSON.stringify(before)).not.toContain("private-original-filename");
    expect(JSON.stringify(before)).not.toContain(
      "private-attached-storage-key",
    );
    expect(JSON.stringify(before)).not.toContain("private-pending-storage-key");
    expect(compareSeedRound2Audit(before, await capture()).ok).toBe(true);
    await database.db
      .update(messageAttachments)
      .set({ size: 11 })
      .where(eq(messageAttachments.id, attached!.id));
    await database.db
      .delete(messageAttachments)
      .where(eq(messageAttachments.id, pending!.id));
    const comparison = compareSeedRound2Audit(before, await capture());
    expect(comparison.ok).toBe(false);
    expect(comparison.issues).toHaveLength(2);
    expect(comparison.issues).toEqual(
      expect.arrayContaining([
        {
          table: "message_attachments",
          key: JSON.stringify([attached!.id]),
          kind: "changed_row",
        },
        {
          table: "message_attachments",
          key: JSON.stringify([pending!.id]),
          kind: "missing_row",
        },
      ]),
    );
  });

  it("detects changed or removed call rows without returning participant data", async () => {
    const [space] = await database.db
      .insert(chatSpaces)
      .values({ kind: "team", teamId: actors.teamId })
      .returning();
    const [room] = await database.db
      .insert(chatRooms)
      .values({
        kind: "voice",
        name: "회의실",
        spaceId: space!.id,
        voiceCapacity: 10,
      })
      .returning();
    const [call] = await database.db
      .insert(callSessions)
      .values({
        roomId: room!.id,
        kind: "voice",
        startedBy: actors.person.userId,
        startedAt: bookingNow,
      })
      .returning();
    const [participant] = await database.db
      .insert(callParticipants)
      .values({
        sessionId: call!.id,
        userId: actors.person.userId,
        joinedAt: bookingNow,
        lastSeenAt: bookingNow,
      })
      .returning();
    const before = await capture();
    expect(
      before.tables.filter(({ table }) => table.startsWith("call_")),
    ).toHaveLength(2);
    await database.db
      .update(callSessions)
      .set({ endedAt: bookingNow })
      .where(eq(callSessions.id, call!.id));
    await database.db
      .delete(callParticipants)
      .where(eq(callParticipants.id, participant!.id));
    expect(compareSeedRound2Audit(before, await capture()).issues).toEqual([
      {
        table: "call_sessions",
        key: JSON.stringify([call!.id]),
        kind: "changed_row",
      },
      {
        table: "call_participants",
        key: JSON.stringify([participant!.id]),
        kind: "missing_row",
      },
    ]);
  });

  it("protects space members and invitation counters without exposing invitation codes", async () => {
    const [space] = await database.db
      .insert(chatSpaces)
      .values({
        kind: "community",
        name: "보존할 모임",
        createdBy: actors.person.userId,
      })
      .returning();
    await database.db.insert(chatSpaceMembers).values({
      spaceId: space!.id,
      userId: actors.person.userId,
      role: "owner",
      joinedAt: bookingNow,
      statusChangedAt: bookingNow,
    });
    const [invite] = await database.db
      .insert(chatSpaceInvites)
      .values({
        spaceId: space!.id,
        createdBy: actors.person.userId,
        code: "private-invitation-code",
      })
      .returning();
    const before = await capture();
    expect(JSON.stringify(before)).not.toContain("private-invitation-code");
    await database.db
      .update(chatSpaceMembers)
      .set({ status: "banned" })
      .where(eq(chatSpaceMembers.spaceId, space!.id));
    await database.db
      .update(chatSpaceInvites)
      .set({ useCount: 1 })
      .where(eq(chatSpaceInvites.id, invite!.id));
    const difference = compareSeedRound2Audit(before, await capture());
    expect(difference.ok).toBe(false);
    expect(difference.issues.map(({ table }) => table).sort()).toEqual([
      "chat_space_invites",
      "chat_space_members",
    ]);
  });

  it("returns stable PK-only fingerprints, never account secrets or personal fields", async () => {
    const accountId = crypto.randomUUID();
    const passwordHash = "private-test-password-hash";
    const sessionToken = "private-test-session-token";
    const oauthToken = "private-test-oauth-token";
    await database.db.insert(authAccounts).values({
      id: accountId,
      userId: actors.person.userId,
      providerId: "credential",
      accountId: actors.person.userId,
      password: passwordHash,
      accessToken: oauthToken,
    });
    await database.db.insert(authSessions).values({
      userId: actors.person.userId,
      token: sessionToken,
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    await database.db.insert(authVerifications).values({
      identifier: actors.person.email,
      value: "private-verification-token",
      expiresAt: new Date("2027-01-01T00:00:00Z"),
    });
    const before = await capture();
    expect(await capture()).toEqual(before);
    expect(before.tables).toHaveLength(37);
    expect(before.tables.map(({ table }) => table)).toEqual(
      expect.arrayContaining([
        "chat_room_members",
        "chat_room_reads",
        "chat_space_prefs",
        "message_mentions",
        "message_reactions",
        "friendships",
        "user_blocks",
        "reports",
      ]),
    );
    expect(before.tables.every((table) => table.exists)).toBe(true);
    const account = before.tables.find(
      ({ table }) => table === "auth_accounts",
    );
    expect(account?.rows).toEqual([
      {
        key: JSON.stringify([accountId]),
        hash: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    ]);
    for (const secret of [
      passwordHash,
      sessionToken,
      oauthToken,
      "private-verification-token",
      actors.person.email,
      actors.person.name,
    ])
      expect(JSON.stringify(before)).not.toContain(secret);
    await database.db
      .update(authAccounts)
      .set({ password: "changed-private-password-hash" })
      .where(eq(authAccounts.id, accountId));
    const comparison = compareSeedRound2Audit(before, await capture());
    expect(comparison).toEqual({
      ok: false,
      issues: [
        {
          table: "auth_accounts",
          key: JSON.stringify([accountId]),
          kind: "changed_row",
        },
      ],
      added: [],
    });
    expect(JSON.stringify(comparison)).not.toContain("password");
  });

  it("allows only the six seed attendee_count fields when explicitly requested", async () => {
    for (const [index, row] of bookingRound2.attendeeCounts.entries())
      await insertFixtureBooking(database, actors, {
        id: row.bookingId,
        during: bookingRange("12:00", "13:00", `2026-10-${10 + index}`),
      });
    const extra = await insertFixtureBooking(database, actors);
    const strict = await capture();
    const allowed = await capture(true);
    expect(allowed.ignoredAttendeeCountBookingIds).toHaveLength(6);
    for (const row of bookingRound2.attendeeCounts)
      await database.db
        .update(bookings)
        .set({ attendeeCount: row.attendeeCount })
        .where(eq(bookings.id, row.bookingId));
    expect(compareSeedRound2Audit(strict, await capture()).issues).toHaveLength(
      6,
    );
    expect(compareSeedRound2Audit(allowed, await capture(true))).toEqual({
      ok: true,
      issues: [],
      added: [],
    });
    await database.db
      .update(bookings)
      .set({ attendeeCount: 2 })
      .where(eq(bookings.id, extra.id));
    expect(compareSeedRound2Audit(allowed, await capture(true)).issues).toEqual(
      [
        {
          table: "bookings",
          key: JSON.stringify([extra.id]),
          kind: "changed_row",
        },
      ],
    );
    expect(() => compareSeedRound2Audit(strict, allowed)).toThrow(
      "보호 데이터의 비교 규칙이 서로 달라요.",
    );
  });

  it.each(["title", "during"] as const)(
    "detects %s changes even on an excepted seed booking",
    async (field) => {
      const id = bookingRound2.attendeeCounts[0]!.bookingId;
      await insertFixtureBooking(database, actors, { id });
      const before = await capture(true);
      await database.db
        .update(bookings)
        .set(
          field === "title"
            ? { title: "변경한 제목" }
            : { during: bookingRange("13:00", "14:00") },
        )
        .where(eq(bookings.id, id));
      expect(
        compareSeedRound2Audit(before, await capture(true)).issues,
      ).toEqual([
        { table: "bookings", key: JSON.stringify([id]), kind: "changed_row" },
      ]);
    },
  );

  it("does not treat new rows as changes to existing rows and reports exact added keys", async () => {
    const booking = await insertFixtureBooking(database, actors);
    const before = await capture();
    const added = await insertFixtureBooking(database, actors, {
      during: bookingRange("13:00", "14:00"),
    });
    await database.db
      .insert(bookingParticipants)
      .values({ bookingId: booking.id, userId: actors.member.userId });
    expect(compareSeedRound2Audit(before, await capture())).toEqual({
      ok: true,
      issues: [],
      added: [
        { table: "bookings", count: 1, keys: [JSON.stringify([added.id])] },
        {
          table: "booking_participants",
          count: 1,
          keys: [JSON.stringify([booking.id, actors.member.userId])],
        },
      ],
    });
  });

  it("detects deletion of baseline rows and changes in chat or composite-key rows", async () => {
    await insertFixtureBooking(database, actors);
    const [space] = await database.db
      .insert(chatSpaces)
      .values({ kind: "team", teamId: actors.teamId })
      .returning();
    if (!space) throw new Error("Expected test space.");
    const [room] = await database.db
      .insert(chatRooms)
      .values({ kind: "text", spaceId: space.id, name: "일반" })
      .returning();
    if (!room) throw new Error("Expected test room.");
    const [message] = await database.db
      .insert(messages)
      .values({
        roomId: room.id,
        seq: 1,
        authorId: actors.person.userId,
        body: "비공개 원문",
      })
      .returning();
    if (!message) throw new Error("Expected test message.");
    await database.db.insert(roleSettings).values({
      branchId: actors.branchId,
      role: "user",
      permissions: ["floor.view"],
    });
    const before = await capture();
    expect(JSON.stringify(before)).not.toContain("비공개 원문");
    await database.db
      .delete(teamMembers)
      .where(eq(teamMembers.userId, actors.member.userId));
    await database.db
      .update(messages)
      .set({ body: "변경된 비공개 원문" })
      .where(eq(messages.id, message.id));
    await database.db
      .update(roleSettings)
      .set({ limits: { maxMinutesPerDay: 30 } });
    const comparison = compareSeedRound2Audit(before, await capture());
    expect(comparison.ok).toBe(false);
    expect(
      comparison.issues.filter((issue) => issue.table === "team_members"),
    ).toHaveLength(2);
    expect(comparison.issues).toContainEqual({
      table: "messages",
      key: JSON.stringify([message.id]),
      kind: "changed_row",
    });
    expect(comparison.issues).toContainEqual({
      table: "role_settings",
      key: JSON.stringify([actors.branchId, "user"]),
      kind: "changed_row",
    });
  });

  it("preserves bigint precision while fingerprinting raw JSONB", async () => {
    const [space] = await database.db
      .insert(chatSpaces)
      .values({ kind: "team", teamId: actors.teamId })
      .returning();
    if (!space) throw new Error("Expected test space.");
    const [room] = await database.db
      .insert(chatRooms)
      .values({ kind: "text", spaceId: space.id, name: "일반" })
      .returning();
    if (!room) throw new Error("Expected test room.");
    const id = crypto.randomUUID();
    await database.db.execute(
      sql`insert into messages (id, room_id, seq, body, kind, system_data) values (${id}, ${room.id}, 9007199254740992, 'precision fixture', 'system', '{"type":"group_created","actorName":"테스트"}'::jsonb)`,
    );
    const before = await capture();
    await database.db.execute(
      sql`update messages set seq = 9007199254740993 where id = ${id}`,
    );
    expect(compareSeedRound2Audit(before, await capture()).issues).toEqual([
      { table: "messages", key: JSON.stringify([id]), kind: "changed_row" },
    ]);
  });

  it("normalizes newly added nullable booking columns and tolerates tables absent before migrations", async () => {
    const booking = await insertFixtureBooking(database, actors);
    const rollback = new Error("test rollback");
    await expect(
      database.db.transaction(async (tx) => {
        await tx.execute(sql`drop table notifications, booking_participants`);
        await tx.execute(sql`alter table bookings drop column attendee_count`);
        await tx.execute(
          sql`alter table bookings drop column if exists updated_at`,
        );
        const before = await captureSeedRound2Audit({}, tx);
        expect(
          before.tables.find(({ table }) => table === "notifications")?.exists,
        ).toBe(false);
        await tx.execute(
          sql`alter table bookings add column attendee_count integer, add column updated_at timestamptz`,
        );
        await tx.execute(
          sql`create table booking_participants (booking_id uuid not null, user_id uuid not null, created_at timestamptz not null default now(), primary key (booking_id, user_id))`,
        );
        const after = await captureSeedRound2Audit({}, tx);
        expect(compareSeedRound2Audit(before, after)).toEqual({
          ok: true,
          issues: [],
          added: [],
        });
        await tx.execute(
          sql`update bookings set updated_at = ${bookingNow.toISOString()}::timestamptz where id = ${booking.id}`,
        );
        expect(
          compareSeedRound2Audit(before, await captureSeedRound2Audit({}, tx))
            .issues,
        ).toEqual([
          {
            table: "bookings",
            key: JSON.stringify([booking.id]),
            kind: "changed_row",
          },
        ]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it("reports a missing table even when it had no rows and ignores non-whitelisted tables", async () => {
    const before = await capture();
    const rollback = new Error("test rollback");
    await expect(
      database.db.transaction(async (tx) => {
        await tx.execute(sql`drop table notifications`);
        await tx.execute(sql`create table private_audit_probe (secret text)`);
        await tx.execute(
          sql`insert into private_audit_probe values ('not-an-app-row')`,
        );
        const after = await captureSeedRound2Audit({}, tx);
        expect(
          after.tables.some(
            ({ table }) => String(table) === "private_audit_probe",
          ),
        ).toBe(false);
        expect(compareSeedRound2Audit(before, after).issues).toEqual([
          { table: "notifications", key: null, kind: "missing_table" },
        ]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it("reads only safe migration metadata, or an empty history before the migration table exists", async () => {
    const before = await capture();
    const history = await readSeedRound2MigrationHistory(database.db);
    expect(history.length).toBeGreaterThan(0);
    expect(history.map((row) => row.id)).toEqual(
      history.map((row) => row.id).sort((a, b) => a - b),
    );
    expect(
      history.every(
        (row) => Object.keys(row).sort().join(",") === "createdAt,hash,id",
      ),
    ).toBe(true);
    expect(await capture()).toEqual(before);
    const rollback = new Error("test rollback");
    await expect(
      database.db.transaction(async (tx) => {
        await tx.execute(
          sql`alter table drizzle.__drizzle_migrations rename to hidden_migration_history`,
        );
        expect(await readSeedRound2MigrationHistory(tx)).toEqual([]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it("does not return driver errors or secrets when a read fails", async () => {
    const spy = vi.spyOn(database.db, "select");
    try {
      spy.mockImplementationOnce(() => {
        throw new Error("postgres://private-connection-value");
      });
      const captureError: unknown = await capture().catch(
        (error: unknown) => error,
      );
      expect(captureError).toBeInstanceOf(Error);
      expect(captureError).toHaveProperty(
        "message",
        "예약 2차 보호 데이터 확인에 실패했어요.",
      );
      expect(captureError).not.toHaveProperty("cause");
      spy.mockImplementationOnce(() => {
        throw new Error("private-driver-token");
      });
      const historyError: unknown = await readSeedRound2MigrationHistory(
        database.db,
      ).catch((error: unknown) => error);
      expect(historyError).toBeInstanceOf(Error);
      expect(historyError).toHaveProperty(
        "message",
        "마이그레이션 이력을 확인하지 못했어요.",
      );
      expect(historyError).not.toHaveProperty("cause");
      spy.mockImplementationOnce(() => {
        throw new Error("private-prerequisite-token");
      });
      const prerequisiteError: unknown = await validateSeedRound2Prerequisites(
        database.db,
      ).catch((error: unknown) => error);
      expect(prerequisiteError).toHaveProperty(
        "message",
        "예약 2차 적용 전제 조건을 확인하지 못했어요.",
      );
      expect(prerequisiteError).not.toHaveProperty("cause");
    } finally {
      spy.mockRestore();
    }
  });

  async function preparePrerequisites() {
    const data = loadSeedData();
    await database.db.execute(
      sql`truncate users, branches, auth_verifications cascade`,
    );
    const userRows = await database.db
      .insert(users)
      .values(
        data.users.map(({ email, name }) => ({
          email,
          name,
          emailVerified: true,
        })),
      )
      .returning();
    const userId = (key: string) => {
      const email = data.users.find((user) => user.key === key)?.email;
      const user = userRows.find((user) => user.email === email);
      if (!user) throw new Error("Missing prerequisite test user.");
      return user.id;
    };
    await database.db.insert(branches).values(data.branches);
    await database.db.insert(floors).values(data.floors);
    await database.db
      .insert(spaces)
      .values(data.spaces.filter(({ parentId }) => parentId === null));
    await database.db
      .insert(spaces)
      .values(data.spaces.filter(({ parentId }) => parentId !== null));
    await database.db.insert(teams).values(
      data.teams.map(({ createdByKey, ...team }) => ({
        ...team,
        createdBy: userId(createdByKey),
      })),
    );
    await database.db.insert(bookings).values(
      data.bookings.map((booking, index) => ({
        id: booking.id,
        spaceId: booking.spaceId,
        userId: userId(booking.userKey),
        teamId: booking.teamId,
        during: bookingRange(
          "12:00",
          "13:00",
          `2027-01-${String(index + 1).padStart(2, "0")}`,
        ),
      })),
    );
    return { data, userId };
  }

  it("checks exact existing source references without returning account values or changing rows", async () => {
    const { data } = await preparePrerequisites();
    const before = await capture();
    const result = await validateSeedRound2Prerequisites(database.db);
    expect(result).toMatchObject({
      ok: true,
      issues: [],
      counts: {
        requiredAccounts: 6,
        verifiedAccounts: 6,
        requiredBookings: 21,
        matchingBookings: 21,
        existingAttendeeCounts: 0,
        existingParticipants: 0,
        existingReminders: 0,
      },
    });
    expect(await capture()).toEqual(before);
    for (const user of data.users) {
      expect(JSON.stringify(result)).not.toContain(user.email);
      expect(JSON.stringify(result)).not.toContain(user.name);
      expect(JSON.stringify(result)).not.toContain(user.password);
    }
  });

  it("validates legacy rows before attendee, participant and notification migrations exist", async () => {
    await preparePrerequisites();
    const rollback = new Error("test rollback");
    await expect(
      database.db.transaction(async (tx) => {
        await tx.execute(sql`drop table notifications`);
        await tx.execute(sql`drop table booking_participants`);
        await tx.execute(sql`alter table bookings drop column attendee_count`);
        await tx.execute(
          sql`alter table bookings drop column if exists updated_at`,
        );
        expect(await validateSeedRound2Prerequisites(tx)).toMatchObject({
          ok: true,
          issues: [],
          counts: {
            matchingBookings: 21,
            existingAttendeeCounts: 0,
            existingParticipants: 0,
            existingReminders: 0,
          },
        });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });

  it("fails closed for unverified accounts and changed booking or parent relationships", async () => {
    const { data, userId } = await preparePrerequisites();
    const source = data.bookings[0]!;
    await database.db
      .update(users)
      .set({ emailVerified: false })
      .where(eq(users.id, userId("designMember")));
    await database.db
      .update(bookings)
      .set({ userId: userId(source.userKey === "admin" ? "member" : "admin") })
      .where(eq(bookings.id, source.id));
    await database.db
      .update(spaces)
      .set({ type: "lounge" })
      .where(eq(spaces.id, source.spaceId));
    const floor = data.floors.find(({ id }) =>
      data.spaces.some(
        (space) => space.id === source.spaceId && space.floorId === id,
      ),
    )!;
    const otherBranch = data.branches.find(({ id }) => id !== floor.branchId)!;
    await database.db
      .update(floors)
      .set({ branchId: otherBranch.id, level: 98 })
      .where(eq(floors.id, floor.id));
    const result = await validateSeedRound2Prerequisites(database.db);
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([
        { code: "missing_verified_account", count: 1 },
        { code: "booking_relationship_mismatch", count: expect.any(Number) },
        { code: "space_relationship_mismatch", count: 1 },
        { code: "floor_relationship_mismatch", count: 1 },
      ]),
    );
  });

  it("reports partial application and UUID collisions in either target table", async () => {
    const { data, userId } = await preparePrerequisites();
    const target = bookingRound2.attendeeCounts[0]!;
    const source = data.bookings.find(({ id }) => id === target.bookingId)!;
    await database.db
      .update(bookings)
      .set({ attendeeCount: target.attendeeCount })
      .where(eq(bookings.id, target.bookingId));
    await database.db.insert(bookings).values({
      id: bookingRound2.deskBlocks[0]!.id,
      spaceId: source.spaceId,
      userId: userId(source.userKey),
      during: bookingRange("12:00", "13:00", "2027-02-01"),
    });
    await database.db.insert(spaceBlocks).values({
      id: bookingRound2.deskBookings[0]!.id,
      spaceId: source.spaceId,
      createdBy: userId("admin"),
      during: bookingRange("12:00", "13:00", "2027-02-02"),
    });
    await database.db
      .insert(bookingParticipants)
      .values({ bookingId: target.bookingId, userId: userId("designMember") });
    await database.db.insert(notifications).values({
      userId: userId(source.userKey),
      bookingId: target.bookingId,
      type: "booking_reminder",
      scheduledFor: bookingNow,
      expiresAt: new Date("2027-01-01T04:00:00Z"),
      data: {
        branchName: "지점",
        floorName: "층",
        spaceName: "공간",
        timezone: "Asia/Seoul",
        start: "2027-01-01T03:00:00Z",
        end: "2027-01-01T04:00:00Z",
        minutesBefore: 0,
      },
    });
    const result = await validateSeedRound2Prerequisites(database.db);
    expect(result).toMatchObject({
      ok: false,
      issues: [
        { code: "new_booking_id_collision", count: 1 },
        { code: "new_block_id_collision", count: 1 },
        { code: "attendee_count_already_set", count: 1 },
        { code: "participants_already_present", count: 1 },
        { code: "reminders_already_present", count: 1 },
      ],
    });
  });

  it("reports missing required legacy tables with fixed issue codes only", async () => {
    const rollback = new Error("test rollback");
    await expect(
      database.db.transaction(async (tx) => {
        await tx.execute(sql`alter table bookings rename to hidden_bookings`);
        expect(await validateSeedRound2Prerequisites(tx)).toEqual({
          ok: false,
          issues: [{ code: "missing_legacy_table", count: 1 }],
          counts: null,
        });
        throw rollback;
      }),
    ).rejects.toBe(rollback);
  });
});
