import "server-only";

import { asc } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { chatSpaces } from "@/lib/db/schema";
import {
  chatSpaceKindOrder,
  chatSpaceName,
  readableSpaceCondition,
} from "./chat-access";
import type { DalDatabase } from "./database";

export function listRealtimeSpaces(
  userId: string,
  database: DalDatabase = getDb(),
) {
  return database
    .select({ id: chatSpaces.id, kind: chatSpaces.kind })
    .from(chatSpaces)
    .where(readableSpaceCondition(userId))
    .orderBy(asc(chatSpaceKindOrder), asc(chatSpaceName), asc(chatSpaces.id))
    .limit(100);
}
