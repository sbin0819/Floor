import "server-only";

import { and, count, eq, isNull, sql } from "drizzle-orm";
import { messages, messageReactions } from "@/lib/db/schema";
import type { ReactionEmoji } from "@/features/chat/types";
import type { DalDatabase } from "./database";
import { ActionError } from "@/lib/actions/result";

export async function setMessageReaction(
  input: {
    messageId: string;
    userId: string;
    emoji: ReactionEmoji;
    on: boolean;
    now: Date;
  },
  database: DalDatabase,
) {
  const [message] = await database
    .select({ id: messages.id, seq: messages.seq })
    .from(messages)
    .where(
      and(
        eq(messages.id, input.messageId),
        eq(messages.kind, "text"),
        isNull(messages.deletedAt),
      ),
    )
    .for("share");
  if (!message) throw new ActionError("NOT_FOUND");
  const changed = input.on
    ? await database
        .insert(messageReactions)
        .select(
          database
            .select({
              messageId: messages.id,
              userId: sql<string>`${input.userId}::uuid`.as("user_id"),
              emoji: sql<ReactionEmoji>`${input.emoji}::reaction_emoji`.as(
                "emoji",
              ),
              createdAt: sql<Date>`${input.now.toISOString()}::timestamptz`.as(
                "created_at",
              ),
            })
            .from(messages)
            .where(
              and(eq(messages.id, input.messageId), isNull(messages.deletedAt)),
            )
            .for("share"),
        )
        .onConflictDoNothing()
        .returning({ id: messageReactions.messageId })
    : await database
        .delete(messageReactions)
        .where(
          and(
            eq(messageReactions.messageId, input.messageId),
            eq(messageReactions.userId, input.userId),
            eq(messageReactions.emoji, input.emoji),
          ),
        )
        .returning({ id: messageReactions.messageId });
  const [result] = await database
    .select({
      count: count(),
      mine: sql<boolean>`coalesce(bool_or(${messageReactions.userId} = ${input.userId}), false)`,
    })
    .from(messageReactions)
    .where(
      and(
        eq(messageReactions.messageId, input.messageId),
        eq(messageReactions.emoji, input.emoji),
      ),
    );
  return {
    changed: changed.length > 0,
    count: result?.count ?? 0,
    mine: result?.mine ?? false,
  };
}
