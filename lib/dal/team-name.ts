import "server-only";

import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export function teamDisplayName(table: {
  name: AnyPgColumn;
  deletedAt: AnyPgColumn;
}) {
  return sql<string>`case when ${table.deletedAt} is null then ${table.name} else '지운 팀' end`;
}
