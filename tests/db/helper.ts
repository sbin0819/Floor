import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import * as schema from "@/lib/db/schema";

export async function createTestDatabase() {
  const client = new PGlite({ extensions: { btree_gist } });
  const db = drizzle({ client, schema });
  try {
    await migrate(db, { migrationsFolder: "./drizzle" });
    return { db, client };
  } catch (error) {
    await client.close();
    throw error;
  }
}

export type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
