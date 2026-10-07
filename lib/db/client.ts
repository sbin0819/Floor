import "server-only";

import { neonConfig, Pool } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { getEnv } from "@/lib/env";
import * as schema from "./schema";

export type Database = NeonDatabase<typeof schema>;

let database: Database | undefined;
let pool: Pool | undefined;

export function getDb(): Database {
  if (database) return database;

  const { DATABASE_URL } = getEnv();
  if (!DATABASE_URL) {
    throw new Error("DATABASE_URL is required when accessing the database.");
  }

  neonConfig.webSocketConstructor = WebSocket;
  pool = new Pool({ connectionString: DATABASE_URL });
  database = drizzle({ client: pool, schema });
  return database;
}

export async function closeDb(): Promise<void> {
  const activePool = pool;
  pool = undefined;
  database = undefined;
  await activePool?.end();
}
