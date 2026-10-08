import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { ActionError } from "@/lib/actions/result";
import { callParticipants, callSessions, users } from "@/lib/db/schema";
import { getDb } from "@/lib/db/client";
import type { ChatMessage } from "@/features/chat/types";
import type { DalDatabase } from "./database";
import { insertSystemMessage } from "./chat-write";
import { readCallParticipants, readOpenCall } from "./call-read";

export async function lockCallUser(userId: string, database: DalDatabase) {
  const [user] = await database
    .select({ id: users.id, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  if (!user) throw new ActionError("NOT_FOUND");
  return user;
}

export async function touchCallParticipant(
  userId: string,
  participantId: string,
  now: Date,
  database: DalDatabase = getDb(),
) {
  const rows = await database
    .update(callParticipants)
    .set({ lastSeenAt: now })
    .where(
      and(
        eq(callParticipants.id, participantId),
        eq(callParticipants.userId, userId),
        isNull(callParticipants.leftAt),
      ),
    )
    .returning({ id: callParticipants.id });
  return rows.length > 0;
}

export function isCurrentParticipant(
  person: { leftAt: Date | null; lastSeenAt: Date },
  now: Date,
) {
  return (
    person.leftAt === null &&
    person.lastSeenAt.getTime() > now.getTime() - 120_000
  );
}

// 호출자가 사용자 → 방 순으로 잠근 뒤에만 통화·참가를 잠근다.
export async function finishEmptyCall(
  session: NonNullable<Awaited<ReturnType<typeof readOpenCall>>>,
  now: Date,
  database: DalDatabase,
  delayed = false,
): Promise<ChatMessage[]> {
  const people = await readCallParticipants(session.id, database, true);
  if (people.some((person) => isCurrentParticipant(person, now))) return [];
  const lastActivity = Math.max(
    session.startedAt.getTime(),
    ...people.map((person) =>
      Math.max(person.lastSeenAt.getTime(), person.leftAt?.getTime() ?? 0),
    ),
  );
  const endedAt = delayed
    ? new Date(Math.min(now.getTime(), lastActivity))
    : now;
  const changed = await database
    .update(callSessions)
    .set({ endedAt })
    .where(and(eq(callSessions.id, session.id), isNull(callSessions.endedAt)))
    .returning({ id: callSessions.id });
  if (!changed.length) return [];
  for (const person of people) {
    if (person.leftAt === null)
      await database
        .update(callParticipants)
        .set({ leftAt: person.lastSeenAt })
        .where(
          and(
            eq(callParticipants.id, person.id),
            isNull(callParticipants.leftAt),
          ),
        );
  }
  if (session.kind === "voice") return [];
  return [
    await insertSystemMessage(
      {
        roomId: session.roomId,
        data: {
          type: "huddle_ended",
          durationMinutes: Math.max(
            0,
            Math.floor(
              (endedAt.getTime() - session.startedAt.getTime()) / 60_000,
            ),
          ),
        },
        now: endedAt,
      },
      database,
    ),
  ];
}

export async function closeCallParticipant(
  participantId: string,
  sessionId: string,
  now: Date,
  database: DalDatabase,
) {
  const [session] = await database
    .select()
    .from(callSessions)
    .where(eq(callSessions.id, sessionId))
    .for("update");
  if (!session) return { changed: false, messages: [] as ChatMessage[] };
  await readCallParticipants(sessionId, database, true);
  const [changed] = await database
    .update(callParticipants)
    .set({ leftAt: now })
    .where(
      and(
        eq(callParticipants.id, participantId),
        eq(callParticipants.sessionId, sessionId),
        isNull(callParticipants.leftAt),
      ),
    )
    .returning({ id: callParticipants.id });
  if (!changed) return { changed: false, messages: [] as ChatMessage[] };
  return {
    changed: true,
    messages: session.endedAt
      ? []
      : await finishEmptyCall(session, now, database),
  };
}

export async function beginCallParticipant(
  input: {
    roomId: string;
    userId: string;
    name: string;
    kind: "voice" | "huddle";
    capacity: number;
    now: Date;
  },
  database: DalDatabase,
) {
  let session = await readOpenCall(input.roomId, database, true);
  const messages: ChatMessage[] = [];
  const replaced: string[] = [];
  if (session) {
    const people = await readCallParticipants(session.id, database, true);
    const mine = people.find(
      (person) => person.userId === input.userId && person.leftAt === null,
    );
    const others = people.filter(
      (person) =>
        person.userId !== input.userId &&
        isCurrentParticipant(person, input.now),
    );
    if (others.length >= input.capacity)
      throw new ActionError("LIMIT_EXCEEDED", { message: "call_full" });
    if (!mine && !others.length) {
      messages.push(
        ...(await finishEmptyCall(session, input.now, database, true)),
      );
      session = null;
    } else if (mine) {
      await database
        .update(callParticipants)
        .set({ leftAt: input.now })
        .where(
          and(
            eq(callParticipants.id, mine.id),
            isNull(callParticipants.leftAt),
          ),
        );
      replaced.push(mine.id);
    }
  }
  const created = session === null;
  if (!session) {
    const [inserted] = await database
      .insert(callSessions)
      .values({
        roomId: input.roomId,
        kind: input.kind,
        startedBy: input.kind === "huddle" ? input.userId : null,
        startedAt: input.now,
      })
      .returning();
    if (!inserted) throw new ActionError("INTERNAL");
    session = inserted;
  }
  const [participant] = await database
    .insert(callParticipants)
    .values({
      sessionId: session.id,
      userId: input.userId,
      joinedAt: input.now,
      lastSeenAt: input.now,
    })
    .returning({ id: callParticipants.id });
  if (!participant) throw new ActionError("INTERNAL");
  if (created && input.kind === "huddle")
    messages.push(
      await insertSystemMessage(
        {
          roomId: input.roomId,
          actorId: input.userId,
          data: { type: "huddle_started", actorName: input.name },
          now: input.now,
        },
        database,
      ),
    );
  return {
    session,
    participantId: participant.id,
    messages,
    replaced,
    created,
  };
}
