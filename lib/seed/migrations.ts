import { readMigrationFiles } from "drizzle-orm/migrator";

export function seedMigrations() {
  return readMigrationFiles({ migrationsFolder: "./drizzle" }).map(
    ({ hash, folderMillis }) => ({ hash, folderMillis }),
  );
}
