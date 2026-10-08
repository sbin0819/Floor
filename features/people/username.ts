import { requireSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";
import {
  createAction,
  type ActionDependencies,
} from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import {
  withTransaction,
  type DalDatabase,
  type TransactionDatabase,
} from "@/lib/dal/database";
import * as names from "@/lib/dal/people-username";
import {
  pickUsername,
  usernameCandidates,
  usernameSuggestionBase,
  USERNAME_COOLDOWN_MS,
} from "@/lib/people/username";
import { usernameSchema } from "./schema";
import type { UsernameSettings } from "./types";

export type PeopleActionDependencies = Partial<ActionDependencies> & {
  database?: DalDatabase & TransactionDatabase;
  now?: () => Date;
};
export type PeopleQueryDependencies = {
  database?: DalDatabase;
  requireSession?: () => Promise<Session>;
  now?: () => Date;
};

export function createUsernameAction(
  dependencies: PeopleActionDependencies = {},
) {
  return createAction(
    {
      input: usernameSchema,
      authorize: "none",
      async handler({ session, input }) {
        const now = dependencies.now?.() ?? new Date();
        return withTransaction(async (tx) => {
          const current = await names.lockUsername(session.userId, tx);
          if (!current) throw new ActionError("NOT_FOUND");
          if (current.username === input.username)
            return { username: input.username };
          if (
            current.username &&
            current.usernameChangedAt &&
            current.usernameChangedAt.getTime() >
              now.getTime() - USERNAME_COOLDOWN_MS
          )
            throw new ActionError("LIMIT_EXCEEDED", {
              message: "username_cooldown",
            });
          await names.saveUsername(
            session.userId,
            input.username,
            current.username === null ? null : now,
            now,
            tx,
          );
          return { username: input.username };
        }, dependencies.database);
      },
    },
    dependencies,
  );
}

export function makeUsernameSettings(
  row: { username: string | null; usernameChangedAt: Date | null },
  candidates: readonly string[],
  taken: ReadonlySet<string>,
  now: Date,
): UsernameSettings {
  const next = row.usernameChangedAt
    ? new Date(row.usernameChangedAt.getTime() + USERNAME_COOLDOWN_MS)
    : null;
  return {
    username: row.username,
    usernameChangedAt: row.usernameChangedAt?.toISOString() ?? null,
    nextChangeAt:
      row.username !== null && next && next > now ? next.toISOString() : null,
    now: now.toISOString(),
    suggestion: row.username === null ? pickUsername(candidates, taken) : null,
  };
}

export async function readUsernameSettings(
  session: Session,
  now: Date,
  database?: DalDatabase,
): Promise<UsernameSettings> {
  const candidates = usernameCandidates(usernameSuggestionBase(session.email));
  const [row, taken] = await Promise.all([
    names.readUsername(session.userId, database),
    names.listTakenUsernames(candidates, database),
  ]);
  if (!row) throw new ActionError("NOT_FOUND");
  return makeUsernameSettings(row, candidates, taken, now);
}

export function createUsernameQuery(
  dependencies: PeopleQueryDependencies = {},
) {
  return async () => {
    const session = await (dependencies.requireSession ?? requireSession)();
    return readUsernameSettings(
      session,
      dependencies.now?.() ?? new Date(),
      dependencies.database,
    );
  };
}
