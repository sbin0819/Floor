import "server-only";

import type { AnyPgColumn } from "drizzle-orm/pg-core";

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
  };
}
