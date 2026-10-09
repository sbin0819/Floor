import "server-only";

import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { SeedError } from "@/lib/seed/errors";
import { seedMigrations } from "@/lib/seed/migrations";
import type { DalDatabase } from "./database";
import { seedAuditTableKeys } from "./seed-round2-audit";

type AuditTable = keyof typeof seedAuditTableKeys;
type Fingerprint = { key: string; hash: string };
export type ChatSpacesAudit = {
  loungeRoomId: string | null;
  tables: {
    table: AuditTable;
    exists: boolean;
    columns: string[];
    hashColumns: string[];
    count: number;
    hash: string;
    rows: Fingerprint[];
  }[];
};

const names = Object.keys(seedAuditTableKeys) as AuditTable[];
// 이 적용은 지시서 25까지 끝난 DB만 지원한다. 그보다 오래된 채팅 테이블 재생성은 범위 밖이다.
const requiredPrefix = 19;
const minimumSupportedMigrations = 25;
const introducedAt: Partial<Record<AuditTable, number>> = {
  chat_space_members: 19,
  chat_space_invites: 19,
  call_sessions: 20,
  call_participants: 20,
  message_attachments: 21,
};
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const qualified = (table: AuditTable) =>
  sql`${sql.identifier("public")}.${sql.identifier(table)}`;
const failure = () =>
  new SeedError(
    "스페이스 추가 시드의 보호 데이터를 확인하지 못했어요. 적용을 중단해 주세요.",
  );

async function appliedMigrations(database: DalDatabase) {
  const expected = seedMigrations();
  const [journal] = await database
    .select({
      present: sql<boolean>`to_regclass('drizzle.__drizzle_migrations') is not null`,
    })
    .from(sql`(select 1) probe`);
  if (!journal?.present) throw failure();
  const applied = await database
    .select({
      hash: sql<string>`hash`,
      at: sql<string>`created_at::text`,
    })
    .from(sql`drizzle.__drizzle_migrations`)
    .orderBy(sql`id`);
  if (
    expected.length < minimumSupportedMigrations ||
    applied.length < requiredPrefix ||
    applied.length > expected.length ||
    applied.some(
      (entry, index) =>
        entry.hash !== expected[index]?.hash ||
        entry.at !== String(expected[index]?.folderMillis),
    )
  )
    throw failure();
  return { count: applied.length, pending: expected.length - applied.length };
}

export async function preflightChatSpacesMigrations(
  database: DalDatabase = getDb(),
): Promise<number> {
  try {
    return (await appliedMigrations(database)).pending;
  } catch {
    throw new SeedError(
      "스페이스 추가 시드의 마이그레이션 이력이 정확한 순서와 일치하지 않아요.",
    );
  }
}

async function inspectCatalog(database: DalDatabase) {
  const { count: applied } = await appliedMigrations(database);
  const relations = await database
    .select({ name: sql<string>`c.relname`, kind: sql<string>`c.relkind` })
    .from(
      sql`pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace`,
    )
    .where(
      sql`n.nspname = 'public' and c.relkind in ('r', 'p', 'f', 'v', 'm')`,
    );
  if (
    relations.some(
      ({ name, kind }) => kind !== "r" || !names.includes(name as AuditTable),
    )
  )
    throw failure();
  const existing = new Set(relations.map(({ name }) => name));
  if (
    names.some(
      (name) => existing.has(name) !== (introducedAt[name] ?? 0) < applied,
    )
  )
    throw failure();

  const [external, triggers, inherited, columns, keys] = await Promise.all([
    database
      .select({ name: sql<string>`con.conname` })
      .from(
        sql`pg_catalog.pg_constraint con
        join pg_catalog.pg_class source on source.oid = con.conrelid
        join pg_catalog.pg_namespace sn on sn.oid = source.relnamespace
        join pg_catalog.pg_class target on target.oid = con.confrelid
        join pg_catalog.pg_namespace tn on tn.oid = target.relnamespace`,
      )
      .where(
        sql`con.contype = 'f' and ((sn.nspname = 'public' and tn.nspname <> 'public') or (sn.nspname <> 'public' and tn.nspname = 'public'))`,
      ),
    database
      .select({ name: sql<string>`t.tgname` })
      .from(
        sql`pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace`,
      )
      .where(sql`n.nspname = 'public' and not t.tgisinternal`),
    database
      .select({ name: sql<string>`parent.relname` })
      .from(
        sql`pg_catalog.pg_inherits i join pg_catalog.pg_class parent on parent.oid = i.inhparent join pg_catalog.pg_class child on child.oid = i.inhrelid join pg_catalog.pg_namespace pn on pn.oid = parent.relnamespace join pg_catalog.pg_namespace cn on cn.oid = child.relnamespace`,
      )
      .where(sql`pn.nspname = 'public' or cn.nspname = 'public'`),
    database
      .select({ table: sql<string>`c.relname`, column: sql<string>`a.attname` })
      .from(
        sql`pg_catalog.pg_attribute a join pg_catalog.pg_class c on c.oid = a.attrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace`,
      )
      .where(
        sql`n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped`,
      )
      .orderBy(sql`c.relname`, sql`a.attname`),
    database
      .select({
        table: sql<string>`c.relname`,
        columns: sql<
          string[]
        >`array_agg(a.attname::text order by key.ordinality)`,
      })
      .from(
        sql`pg_catalog.pg_constraint con join pg_catalog.pg_class c on c.oid = con.conrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace
        cross join lateral unnest(con.conkey) with ordinality as key(attnum, ordinality)
        join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum = key.attnum`,
      )
      .where(sql`n.nspname = 'public' and con.contype = 'p'`)
      .groupBy(sql`c.relname`),
  ]);
  if (external.length || triggers.length || inherited.length) throw failure();
  for (const name of names) {
    if (!existing.has(name)) continue;
    if (
      JSON.stringify(keys.find((entry) => entry.table === name)?.columns) !==
      JSON.stringify(seedAuditTableKeys[name])
    )
      throw failure();
  }
  return { existing, columns };
}

function validSnapshot(snapshot: ChatSpacesAudit) {
  if (
    snapshot.tables.length !== names.length ||
    new Set(snapshot.tables.map(({ table }) => table)).size !== names.length ||
    snapshot.tables.some(({ table }) => !names.includes(table))
  )
    throw failure();
}

export async function captureChatSpacesAudit(
  {
    baseline,
    loungeRoomId,
  }: { baseline?: ChatSpacesAudit; loungeRoomId?: string } = {},
  database: DalDatabase = getDb(),
): Promise<ChatSpacesAudit> {
  try {
    if (baseline) validSnapshot(baseline);
    const ignoredRoom =
      loungeRoomId?.toLowerCase() ?? baseline?.loungeRoomId ?? null;
    if (
      (ignoredRoom &&
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(
          ignoredRoom,
        )) ||
      (baseline && baseline.loungeRoomId !== ignoredRoom)
    )
      throw failure();
    const catalog = await inspectCatalog(database);
    if (ignoredRoom) await readChatSpacesLoungeCursor(ignoredRoom, database);
    const tables = await Promise.all(
      names.map(async (table) => {
        const exists = catalog.existing.has(table);
        const previous = baseline?.tables.find(
          (entry) => entry.table === table,
        );
        const columns = catalog.columns
          .filter((entry) => entry.table === table)
          .map(({ column }) => column);
        const hashColumns = previous?.exists ? previous.hashColumns : columns;
        if (
          previous?.exists &&
          (!exists ||
            previous.columns.some((column) => !columns.includes(column)))
        )
          throw failure();
        const excludedColumns = columns.filter(
          (column) => !hashColumns.includes(column),
        );
        const fullRow = sql`to_jsonb(audit_row)`;
        const oldColumns = excludedColumns.length
          ? sql`(${fullRow} - ARRAY[${sql.join(
              excludedColumns.map((column) => sql`${column}`),
              sql`, `,
            )}]::text[])`
          : fullRow;
        const normalized =
          table === "chat_rooms" && ignoredRoom
            ? sql`case when audit_row.id = ${ignoredRoom}::uuid then ${oldColumns} - ARRAY['last_seq', 'last_message_at']::text[] else ${oldColumns} end`
            : oldColumns;
        const records = exists
          ? await database
              .select({
                key: sql<string[]>`jsonb_build_array(${sql.join(
                  seedAuditTableKeys[table].map(
                    (column) => sql`audit_row.${sql.identifier(column)}`,
                  ),
                  sql`, `,
                )})`,
                value: sql<string>`(${normalized})::text`,
              })
              .from(sql`${qualified(table)} as audit_row`)
          : [];
        const rows = records
          .map(({ key, value }) => {
            if (
              !Array.isArray(key) ||
              key.length !== seedAuditTableKeys[table].length ||
              !key.every((part) => typeof part === "string") ||
              typeof value !== "string"
            )
              throw failure();
            return { key: JSON.stringify(key), hash: digest(value) };
          })
          .sort((a, b) => a.key.localeCompare(b.key, "en"));
        return {
          table,
          exists,
          columns,
          hashColumns,
          count: rows.length,
          hash: digest(JSON.stringify(rows)),
          rows,
        };
      }),
    );
    return { loungeRoomId: ignoredRoom, tables };
  } catch {
    throw failure();
  }
}

export function compareChatSpacesAudit(
  before: ChatSpacesAudit,
  after: ChatSpacesAudit,
) {
  validSnapshot(before);
  validSnapshot(after);
  if (before.loungeRoomId !== after.loungeRoomId) throw failure();
  const added: { table: AuditTable; count: number; keys: string[] }[] = [];
  const addedTables: AuditTable[] = [];
  const addedColumns: { table: AuditTable; columns: string[] }[] = [];
  for (const previous of before.tables) {
    const current = after.tables.find(({ table }) => table === previous.table)!;
    if (
      previous.exists &&
      (!current.exists ||
        previous.columns.some((column) => !current.columns.includes(column)) ||
        JSON.stringify(previous.hashColumns) !==
          JSON.stringify(current.hashColumns))
    )
      throw failure();
    const next = new Map(current.rows.map((row) => [row.key, row.hash]));
    for (const row of previous.rows)
      if (next.get(row.key) !== row.hash) throw failure();
    const prior = new Set(previous.rows.map((row) => row.key));
    const keys = current.rows
      .filter((row) => !prior.has(row.key))
      .map((row) => row.key);
    if (keys.length)
      added.push({ table: previous.table, count: keys.length, keys });
    if (!previous.exists && current.exists) addedTables.push(previous.table);
    if (previous.exists) {
      const columns = current.columns.filter(
        (column) => !previous.columns.includes(column),
      );
      if (columns.length) addedColumns.push({ table: previous.table, columns });
    }
  }
  return { added, addedTables, addedColumns };
}

export async function readChatSpacesLoungeCursor(
  roomId: string,
  database: DalDatabase = getDb(),
) {
  try {
    const [row] = await database
      .select({
        lastSeq: sql<string>`r.last_seq::text`,
        lastMessageAt: sql<
          string | null
        >`to_char(r.last_message_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(
        sql`public.chat_rooms r join public.chat_spaces s on s.id = r.space_id`,
      )
      .where(
        sql`r.id = ${roomId}::uuid and r.kind = 'text' and s.kind = 'branch' and s.deleted_at is null and r.archived_at is null`,
      );
    if (!row) throw failure();
    return row;
  } catch {
    throw failure();
  }
}
