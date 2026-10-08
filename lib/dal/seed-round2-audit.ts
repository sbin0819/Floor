import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import seedBookings2 from "@/docs/spec/examples/seed-bookings-2.json";
import { getDb } from "@/lib/db/client";
import { loadSeedData } from "@/lib/seed/data";
import { loadSeedBookings2 } from "@/lib/seed/bookings-2";
import type { DalDatabase } from "./database";

// 검증 대상과 키는 코드가 정한다. 이메일·토큰처럼 민감한 값은 키로 쓰지 않는다.
const protectedTables = {
  users: ["id"],
  auth_accounts: ["id"],
  auth_sessions: ["id"],
  auth_verifications: ["id"],
  branches: ["id"],
  floors: ["id"],
  spaces: ["id"],
  teams: ["id"],
  team_members: ["team_id", "user_id"],
  team_invites: ["id"],
  team_join_requests: ["id"],
  branch_staff: ["branch_id", "user_id"],
  role_settings: ["branch_id", "role"],
  access_grants: ["id"],
  bookings: ["id"],
  booking_participants: ["booking_id", "user_id"],
  space_blocks: ["id"],
  space_photos: ["id"],
  floor_plans: ["id"],
  notifications: ["id"],
  chat_rooms: ["id"],
  messages: ["id"],
  message_attachments: ["id"],
  chat_spaces: ["id"],
  chat_space_members: ["space_id", "user_id"],
  chat_space_invites: ["id"],
  call_sessions: ["id"],
  call_participants: ["id"],
} as const;
type ProtectedTable = keyof typeof protectedTables;
type RowFingerprint = { key: string; hash: string };
export type SeedRound2Audit = {
  ignoredAttendeeCountBookingIds: string[];
  tables: {
    table: ProtectedTable;
    exists: boolean;
    count: number;
    hash: string;
    rows: RowFingerprint[];
  }[];
};

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function availableTables(database: DalDatabase) {
  return database
    .select({
      schema: sql<string>`table_schema`,
      table: sql<string>`table_name`,
    })
    .from(sql`information_schema.tables`)
    .where(
      sql`table_type = 'BASE TABLE' and (table_schema = 'public' or (table_schema = 'drizzle' and table_name = '__drizzle_migrations'))`,
    );
}

export async function captureSeedRound2Audit(
  {
    allowSeedAttendeeCounts = false,
  }: { allowSeedAttendeeCounts?: boolean } = {},
  injectedDatabase?: DalDatabase,
): Promise<SeedRound2Audit> {
  try {
    const database = injectedDatabase ?? getDb();
    const ignoredAttendeeCountBookingIds = allowSeedAttendeeCounts
      ? seedBookings2.attendeeCounts.map(({ bookingId }) => bookingId).sort()
      : [];
    const available = new Set(
      (await availableTables(database))
        .filter((entry) => entry.schema === "public")
        .map((entry) => entry.table),
    );
    const tables = await Promise.all(
      (Object.keys(protectedTables) as ProtectedTable[]).map(async (table) => {
        const exists = available.has(table);
        const record = sql`to_jsonb(audit_row)`;
        const ignoreCount = ignoredAttendeeCountBookingIds.length
          ? sql`${record}->>'id' in (${sql.join(
              ignoredAttendeeCountBookingIds.map((id) => sql`${id}`),
              sql`, `,
            )})`
          : sql`false`;
        // JSONB 원문을 해시해 bigint와 timestamp의 정밀도를 JS 변환으로 잃지 않는다.
        // 추가형 마이그레이션의 누락 컬럼과 NULL은 같지만 실제 갱신 시각은 보존한다.
        const normalized =
          table === "bookings"
            ? sql`(${record} || jsonb_build_object(
              'attendee_count', case when ${ignoreCount} then 'null'::jsonb else coalesce(${record}->'attendee_count', 'null'::jsonb) end,
              'updated_at', coalesce(${record}->'updated_at', 'null'::jsonb)
            ))`
            : record;
        const records = exists
          ? await database
              .select({
                key: sql<string[]>`jsonb_build_array(${sql.join(
                  protectedTables[table].map(
                    (column) => sql`audit_row.${sql.identifier(column)}`,
                  ),
                  sql`, `,
                )})`,
                value: sql<string>`${normalized}::text`,
              })
              .from(
                sql`${sql.identifier("public")}.${sql.identifier(table)} as audit_row`,
              )
          : [];
        const rows = records
          .map(({ key, value }) => {
            if (
              !Array.isArray(key) ||
              !key.every((part) => typeof part === "string")
            )
              throw new Error("Invalid audit key.");
            return { key: JSON.stringify(key), hash: hash(value) };
          })
          .sort((a, b) => a.key.localeCompare(b.key, "en"));
        return {
          table,
          exists,
          count: rows.length,
          hash: hash(JSON.stringify(rows)),
          rows,
        };
      }),
    );
    return { ignoredAttendeeCountBookingIds, tables };
  } catch {
    // 드라이버 예외에는 접속 정보나 원문 값이 실릴 수 있어 밖으로 전달하지 않는다.
    throw new Error("예약 2차 보호 데이터 확인에 실패했어요.");
  }
}

export function compareSeedRound2Audit(
  before: SeedRound2Audit,
  after: SeedRound2Audit,
) {
  if (
    JSON.stringify(before.ignoredAttendeeCountBookingIds) !==
    JSON.stringify(after.ignoredAttendeeCountBookingIds)
  )
    throw new Error("보호 데이터의 비교 규칙이 서로 달라요.");
  const issues: {
    table: ProtectedTable;
    key: string | null;
    kind: "missing_table" | "missing_row" | "changed_row";
  }[] = [];
  const added: { table: ProtectedTable; count: number; keys: string[] }[] = [];
  for (const previous of before.tables) {
    const current = after.tables.find(({ table }) => table === previous.table);
    if (!current || (previous.exists && !current.exists)) {
      issues.push({ table: previous.table, key: null, kind: "missing_table" });
      continue;
    }
    const prior = new Map(previous.rows.map((row) => [row.key, row.hash]));
    const next = new Map(current.rows.map((row) => [row.key, row.hash]));
    for (const [key, value] of prior) {
      if (!next.has(key))
        issues.push({ table: previous.table, key, kind: "missing_row" });
      else if (next.get(key) !== value)
        issues.push({ table: previous.table, key, kind: "changed_row" });
    }
    const keys = current.rows
      .filter((row) => !prior.has(row.key))
      .map((row) => row.key);
    if (keys.length)
      added.push({ table: previous.table, count: keys.length, keys });
  }
  return { ok: issues.length === 0, issues, added };
}

export async function readSeedRound2MigrationHistory(
  injectedDatabase?: DalDatabase,
) {
  try {
    const database = injectedDatabase ?? getDb();
    const tables = await availableTables(database);
    if (
      !tables.some(
        ({ schema, table }) =>
          schema === "drizzle" && table === "__drizzle_migrations",
      )
    )
      return [];
    return await database
      .select({
        id: sql<number>`id`,
        hash: sql<string>`hash`,
        createdAt: sql<string | null>`created_at::text`,
      })
      .from(sql`drizzle.__drizzle_migrations`)
      .orderBy(sql`id asc`);
  } catch {
    throw new Error("마이그레이션 이력을 확인하지 못했어요.");
  }
}

type PrerequisiteIssue =
  | "missing_legacy_table"
  | "missing_verified_account"
  | "booking_relationship_mismatch"
  | "space_relationship_mismatch"
  | "floor_relationship_mismatch"
  | "missing_branch"
  | "missing_team"
  | "new_booking_id_collision"
  | "new_block_id_collision"
  | "attendee_count_already_set"
  | "participants_already_present"
  | "reminders_already_present";

// 최초 적용 전용 확인이다. 완료 표식이 있는 재실행 검증은 시드 실행 함수가 맡는다.
export async function validateSeedRound2Prerequisites(
  injectedDatabase?: DalDatabase,
) {
  try {
    const data = loadSeedData();
    const extras = loadSeedBookings2(data);
    const database = injectedDatabase ?? getDb();
    const available = new Set(
      (await availableTables(database))
        .filter(({ schema }) => schema === "public")
        .map(({ table }) => table),
    );
    const issues: { code: PrerequisiteIssue; count: number }[] = [];
    const addIssue = (code: PrerequisiteIssue, count: number) => {
      if (count > 0) issues.push({ code, count });
    };
    const missingTables = [
      "users",
      "branches",
      "floors",
      "spaces",
      "teams",
      "bookings",
      "space_blocks",
    ].filter((table) => !available.has(table));
    if (missingTables.length) {
      addIssue("missing_legacy_table", missingTables.length);
      return { ok: false, issues, counts: null };
    }
    const additionalIds = [...extras.deskBookings, ...extras.deskBlocks].map(
      ({ id }) => id,
    );
    const bookingIds = [...data.bookings.map(({ id }) => id), ...additionalIds];
    const usedSpaces = new Set([
      ...data.bookings.map(({ spaceId }) => spaceId),
      ...extras.deskBookings.map(({ deskId }) => deskId),
      ...extras.deskBlocks.map(({ spaceId }) => spaceId),
    ]);
    for (const space of data.spaces)
      if (usedSpaces.has(space.id) && space.parentId)
        usedSpaces.add(space.parentId);
    const expectedSpaces = data.spaces.filter(({ id }) => usedSpaces.has(id));
    const expectedFloors = data.floors.filter(({ id }) =>
      expectedSpaces.some(({ floorId }) => floorId === id),
    );
    const branchIds = [
      ...new Set(expectedFloors.map(({ branchId }) => branchId)),
    ];
    const teamIds = [
      ...new Set(
        [...data.bookings, ...extras.deskBookings].flatMap(({ teamId }) =>
          teamId ? [teamId] : [],
        ),
      ),
    ];
    const userKeys = new Set([
      ...data.bookings.map(({ userKey }) => userKey),
      ...extras.deskBookings.map(({ userKey }) => userKey),
      ...extras.deskBlocks.map(({ createdByKey }) => createdByKey),
      ...extras.participants.flatMap(({ userKeys }) => userKeys),
    ]);
    const accounts = data.users.filter(({ key }) => userKeys.has(key));
    const values = (entries: readonly string[]) =>
      sql.join(
        entries.map((entry) => sql`${entry}`),
        sql`, `,
      );
    const [
      userRows,
      bookingRows,
      spaceRows,
      floorRows,
      branchRows,
      teamRows,
      blockRows,
      participantRows,
      reminderRows,
    ] = await Promise.all([
      database
        .select({
          id: sql<string>`id`,
          email: sql<string>`email`,
          verified: sql<boolean>`email_verified`,
        })
        .from(sql`public.users`)
        .where(sql`email in (${values(accounts.map(({ email }) => email))})`),
      database
        .select({
          id: sql<string>`id`,
          spaceId: sql<string>`space_id`,
          userId: sql<string>`user_id`,
          teamId: sql<string | null>`team_id`,
          attendeeCount: sql<
            number | null
          >`(to_jsonb(b)->>'attendee_count')::integer`,
        })
        .from(sql`public.bookings as b`)
        .where(sql`id in (${values(bookingIds)})`),
      database
        .select({
          id: sql<string>`id`,
          floorId: sql<string>`floor_id`,
          parentId: sql<string | null>`parent_id`,
          type: sql<string>`type`,
        })
        .from(sql`public.spaces`)
        .where(sql`id in (${values([...usedSpaces])})`),
      database
        .select({ id: sql<string>`id`, branchId: sql<string>`branch_id` })
        .from(sql`public.floors`)
        .where(sql`id in (${values(expectedFloors.map(({ id }) => id))})`),
      database
        .select({ id: sql<string>`id` })
        .from(sql`public.branches`)
        .where(sql`id in (${values(branchIds)})`),
      teamIds.length
        ? database
            .select({ id: sql<string>`id` })
            .from(sql`public.teams`)
            .where(sql`id in (${values(teamIds)})`)
        : [],
      database
        .select({ id: sql<string>`id` })
        .from(sql`public.space_blocks`)
        .where(sql`id in (${values(additionalIds)})`),
      available.has("booking_participants")
        ? database
            .select({ count: sql<number>`count(*)::integer` })
            .from(sql`public.booking_participants`)
            .where(
              sql`booking_id in (${values(extras.participants.map(({ bookingId }) => bookingId))})`,
            )
        : [],
      available.has("notifications")
        ? database
            .select({ count: sql<number>`count(*)::integer` })
            .from(sql`public.notifications`)
            .where(
              sql`booking_id in (${values(bookingIds)}) and type = 'booking_reminder'`,
            )
        : [],
    ]);
    const userIds = new Map(
      accounts.flatMap((account) => {
        const user = userRows.find(({ email }) => email === account.email);
        return user?.verified ? [[account.key, user.id] as const] : [];
      }),
    );
    const matchingBookings = data.bookings.filter((expected) =>
      bookingRows.some(
        (row) =>
          row.id === expected.id &&
          row.spaceId === expected.spaceId &&
          row.teamId === expected.teamId &&
          row.userId === userIds.get(expected.userKey),
      ),
    ).length;
    const matchingSpaces = expectedSpaces.filter((expected) =>
      spaceRows.some(
        (row) =>
          row.id === expected.id &&
          row.floorId === expected.floorId &&
          row.parentId === expected.parentId &&
          row.type === expected.type,
      ),
    ).length;
    const matchingFloors = expectedFloors.filter((expected) =>
      floorRows.some(
        (row) => row.id === expected.id && row.branchId === expected.branchId,
      ),
    ).length;
    const collisions = bookingRows.filter(({ id }) =>
      additionalIds.includes(id),
    ).length;
    const existingAttendeeCounts = extras.attendeeCounts.filter(
      ({ bookingId }) =>
        bookingRows.some(
          ({ id, attendeeCount }) => id === bookingId && attendeeCount !== null,
        ),
    ).length;
    const counts = {
      requiredAccounts: accounts.length,
      verifiedAccounts: userIds.size,
      requiredBookings: data.bookings.length,
      matchingBookings,
      requiredSpaces: expectedSpaces.length,
      matchingSpaces,
      requiredFloors: expectedFloors.length,
      matchingFloors,
      requiredBranches: branchIds.length,
      existingBranches: branchRows.length,
      requiredTeams: teamIds.length,
      existingTeams: teamRows.length,
      newBookingIdCollisions: collisions,
      newBlockIdCollisions: blockRows.length,
      existingAttendeeCounts,
      existingParticipants: participantRows[0]?.count ?? 0,
      existingReminders: reminderRows[0]?.count ?? 0,
    };
    addIssue("missing_verified_account", accounts.length - userIds.size);
    addIssue(
      "booking_relationship_mismatch",
      data.bookings.length - matchingBookings,
    );
    addIssue(
      "space_relationship_mismatch",
      expectedSpaces.length - matchingSpaces,
    );
    addIssue(
      "floor_relationship_mismatch",
      expectedFloors.length - matchingFloors,
    );
    addIssue("missing_branch", branchIds.length - branchRows.length);
    addIssue("missing_team", teamIds.length - teamRows.length);
    addIssue("new_booking_id_collision", collisions);
    addIssue("new_block_id_collision", blockRows.length);
    addIssue("attendee_count_already_set", existingAttendeeCounts);
    addIssue("participants_already_present", counts.existingParticipants);
    addIssue("reminders_already_present", counts.existingReminders);
    return { ok: issues.length === 0, issues, counts };
  } catch {
    throw new Error("예약 2차 적용 전제 조건을 확인하지 못했어요.");
  }
}
