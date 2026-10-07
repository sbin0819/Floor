import "server-only";

import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

import { getDb } from "@/lib/db/client";

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
