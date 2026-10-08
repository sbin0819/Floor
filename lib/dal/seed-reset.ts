import "server-only";

import { getTableName, sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { getDb } from "@/lib/db/client";
import {
  accessGrants,
  authAccounts,
  authSessions,
  authVerifications,
  bookingParticipants,
  bookings,
  branches,
  branchStaff,
  chatRoomMembers,
  chatRoomReads,
  chatRooms,
  chatSpacePrefs,
  chatSpaces,
  floorPlans,
  floors,
  friendships,
  messageMentions,
  messageReactions,
  messages,
  notifications,
  reports,
  roleSettings,
  spaceBlocks,
  spacePhotos,
  spaces,
  teamInvites,
  teamJoinRequests,
  teamMembers,
  teams,
  userBlocks,
  users,
} from "@/lib/db/schema";
import { SeedError } from "@/lib/seed/errors";
import type { DalDatabase } from "./database";

// 개발용 전체 초기화의 허용 목록이다. 스키마에 테이블이 추가돼도 자동으로 삭제 범위를 넓히지 않는다.
const resetTables = [
  accessGrants,
  authAccounts,
  authSessions,
  authVerifications,
  bookingParticipants,
  bookings,
  branches,
  branchStaff,
  chatRoomMembers,
  chatRoomReads,
  chatRooms,
  chatSpacePrefs,
  chatSpaces,
  floorPlans,
  floors,
  friendships,
  messageMentions,
  messageReactions,
  messages,
  notifications,
  reports,
  roleSettings,
  spaceBlocks,
  spacePhotos,
  spaces,
  teamInvites,
  teamJoinRequests,
  teamMembers,
  teams,
  userBlocks,
  users,
] as const;

export type SeedMigration = { hash: string; folderMillis: number };
const names: readonly string[] = resetTables.map(getTableName).sort();
const qualified = (name: string) =>
  sql`${sql.identifier("public")}.${sql.identifier(name)}`;
const targets = sql.join(
  names.map((name) => sql`ONLY ${qualified(name)}`),
  sql`, `,
);

// 카탈로그와 건수만 읽고 인증 정보나 행의 본문은 반환하지 않는다.
export async function inspectSeedReset(
  migrations: readonly SeedMigration[],
  database: DalDatabase = getDb(),
) {
  const relations = await database
    .select({
      name: sql<string>`c.relname`,
      kind: sql<string>`c.relkind`,
    })
    .from(
      sql`pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace`,
    )
    .where(
      sql`n.nspname = 'public' and c.relkind in ('r', 'p', 'f', 'v', 'm')`,
    );
  if (
    relations.length !== names.length ||
    relations.some((row) => row.kind !== "r" || !names.includes(row.name))
  )
    throw new SeedError(
      "초기화 허용 목록과 DB 테이블이 달라요. 데이터를 변경하지 않았어요.",
    );

  const migrationTable = await database
    .select({
      present: sql<boolean>`to_regclass('drizzle.__drizzle_migrations') is not null`,
    })
    .from(sql`(select 1) as probe`);
  if (!migrationTable[0]?.present || !migrations.length)
    throw new SeedError(
      "마이그레이션 이력을 확인할 수 없어 초기화를 중단했어요.",
    );
  const applied = await database
    .select({
      hash: sql<string>`hash`,
      folderMillis: sql<number>`created_at::double precision`,
    })
    .from(sql`drizzle.__drizzle_migrations`)
    .orderBy(sql`created_at`);
  if (
    applied.length !== migrations.length ||
    applied.some(
      (row, index) =>
        row.hash !== migrations[index]?.hash ||
        row.folderMillis !== migrations[index]?.folderMillis,
    )
  )
    throw new SeedError(
      "DB 마이그레이션 이력이 현재 코드와 달라요. 초기화하지 않았어요.",
    );

  const externalReferences = await database
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
    );
  const triggers = await database
    .select({ name: sql<string>`t.tgname` })
    .from(
      sql`pg_catalog.pg_trigger t join pg_catalog.pg_class c on c.oid = t.tgrelid join pg_catalog.pg_namespace n on n.oid = c.relnamespace`,
    )
    .where(sql`n.nspname = 'public' and not t.tgisinternal`);
  const inherited = await database
    .select({ name: sql<string>`parent.relname` })
    .from(
      sql`pg_catalog.pg_inherits i join pg_catalog.pg_class parent on parent.oid = i.inhparent join pg_catalog.pg_class child on child.oid = i.inhrelid join pg_catalog.pg_namespace pn on pn.oid = parent.relnamespace join pg_catalog.pg_namespace cn on cn.oid = child.relnamespace`,
    )
    .where(sql`pn.nspname = 'public' or cn.nspname = 'public'`);
  if (externalReferences.length || triggers.length || inherited.length)
    throw new SeedError(
      "예상하지 않은 외부 참조·트리거·상속이 있어 초기화를 중단했어요.",
    );

  const counts: Record<string, number> = {};
  for (const name of names) {
    const [row] = await database
      .select({ count: sql<number>`count(*)::integer` })
      .from(qualified(name));
    counts[name] = row!.count;
  }
  return { migrationCount: applied.length, counts };
}

function canExecute(
  database: DalDatabase,
): database is DalDatabase & Pick<PgDatabase<PgQueryResultHKT>, "execute"> {
  return "execute" in database && typeof database.execute === "function";
}

// runSeed가 연 트랜잭션 안에서만 호출한다. 새 인증 계정 생성도 같은 트랜잭션을 사용한다.
export async function resetSeedDatabase(
  database: DalDatabase,
  migrations: readonly SeedMigration[],
) {
  if (!canExecute(database))
    throw new SeedError(
      "전체 초기화에 필요한 트랜잭션 기능을 확인할 수 없어요.",
    );
  await database.execute(sql`set local lock_timeout = '5s'`);
  // Drizzle의 스키마 없는 INSERT도 방금 비운 public 테이블을 쓰도록 한다.
  await database.execute(
    sql`set local search_path = pg_catalog, public, pg_temp`,
  );
  // 검사 뒤 외래 키·트리거가 바뀌거나 앱의 쓰기가 끼어들지 않게 삭제 대상 전체를 먼저 잠근다.
  await database.execute(sql`lock table ${targets} in access exclusive mode`);
  const inspection = await inspectSeedReset(migrations, database);
  // CASCADE 없이 명시한 테이블만 비운다. 마이그레이션·확장·다른 스키마는 건드리지 않는다.
  await database.execute(
    sql`truncate table ${targets} continue identity restrict`,
  );
  return inspection;
}
