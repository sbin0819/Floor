import { ActionError } from "@/lib/actions/result";
import {
  withTransaction,
  type DalDatabase,
  type TransactionDatabase,
} from "@/lib/dal";

class ParticipantLockSetChanged extends Error {}

export function assertParticipantsLocked(
  lockedUserIds: readonly string[],
  currentParticipantIds: readonly string[],
) {
  const locked = new Set(lockedUserIds);
  if (currentParticipantIds.some((id) => !locked.has(id)))
    throw new ParticipantLockSetChanged();
}

export async function withParticipantTransaction<T>(
  callback: (database: DalDatabase) => Promise<T>,
  database?: TransactionDatabase,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await withTransaction(callback, database);
    } catch (error) {
      if (!(error instanceof ParticipantLockSetChanged)) throw error;
    }
  }
  throw new ActionError("INTERNAL");
}
