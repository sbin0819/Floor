import "server-only";

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { closeDb, getDb } from "@/lib/db/client";

export type DalDatabase = Pick<
  PgDatabase<PgQueryResultHKT>,
  "select" | "insert" | "update" | "delete"
>;

export type TransactionDatabase = {
  transaction<T>(
    callback: (transaction: DalDatabase) => Promise<T>,
  ): Promise<T>;
};

export async function withTransaction<T>(
  callback: (transaction: DalDatabase) => Promise<T>,
  database: TransactionDatabase = getDb(),
): Promise<T> {
  return database.transaction(callback);
}

export async function closeDatabase(): Promise<void> {
  await closeDb();
}
