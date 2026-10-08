import "server-only";

import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AvatarSource } from "@/lib/avatar";

type AvatarTable = {
  id: AnyPgColumn;
  avatarColor: AnyPgColumn;
  avatarPhoto: AnyPgColumn;
  avatarUrl: AnyPgColumn;
};

export function avatarColumns<T extends AvatarTable>(table: T) {
  return {
    id: table.id,
    avatarColor: table.avatarColor,
    avatarPhoto: table.avatarPhoto,
    avatarUrl: table.avatarUrl,
  } as Pick<T, "id" | "avatarColor" | "avatarPhoto" | "avatarUrl">;
}

export function avatarJson<T extends AvatarTable>(table: T) {
  const columns = avatarColumns(table);
  return sql<AvatarSource>`jsonb_build_object('id', ${columns.id},
    'avatarColor', ${columns.avatarColor}, 'avatarPhoto', ${columns.avatarPhoto},
    'avatarUrl', ${columns.avatarUrl})`;
}
