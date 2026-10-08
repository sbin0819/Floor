import "server-only";

import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import type { AvatarColor } from "@/lib/avatar";
import type { Preferences } from "@/features/settings/schema";
import { avatarColumns } from "./avatar";
import type { DalDatabase } from "./database";

const profileFields = {
  ...avatarColumns(users),
  name: users.name,
  email: users.email,
  emailVerified: users.emailVerified,
  username: users.username,
  usernameChangedAt: users.usernameChangedAt,
};
const preferenceFields = {
  chatToasts: users.chatToasts,
  tabBadge: users.tabBadge,
  reminderMinutes: users.reminderMinutes,
};
export async function readProfileSettings(
  userId: string,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select(profileFields)
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}
export async function lockProfileSettings(
  userId: string,
  database: DalDatabase,
) {
  const [row] = await database
    .select(profileFields)
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  return row ?? null;
}
export async function saveProfileSettings(
  userId: string,
  values: { name?: string; avatarColor?: AvatarColor; avatarPhoto?: boolean },
  now: Date,
  database: DalDatabase,
) {
  const [row] = await database
    .update(users)
    .set({ ...values, updatedAt: now })
    .where(eq(users.id, userId))
    .returning(profileFields);
  return row ?? null;
}
export async function readPreferences(
  userId: string,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .select({ ...preferenceFields, defaultBranchId: users.defaultBranchId })
    .from(users)
    .where(eq(users.id, userId));
  return row ?? null;
}
export async function savePreferences(
  userId: string,
  values: Partial<Preferences>,
  now: Date,
  database: DalDatabase = getDb(),
) {
  const [row] = await database
    .update(users)
    .set({ ...values, updatedAt: now })
    .where(eq(users.id, userId))
    .returning(preferenceFields);
  return row ?? null;
}
