import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";

if (process.argv.includes("migrate")) {
  config({ path: ".env.local", quiet: true });
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema/index.ts",
  out: "./drizzle",
  ...(process.env.DATABASE_URL
    ? { dbCredentials: { url: process.env.DATABASE_URL } }
    : {}),
});
