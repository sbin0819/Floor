import {
  maskParticipantEmail,
  participantQuerySchema,
  type ParticipantSearchResult,
} from "@/features/bookings/participants";
import { requireSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";
import type { DalDatabase } from "@/lib/dal";
import { findParticipants } from "@/lib/dal/participant-search";
import {
  createMemoryRateLimiter,
  RateLimitError,
  type RateLimiter,
} from "@/lib/rate-limit/memory";

const limiter = createMemoryRateLimiter();

export function createParticipantSearch(
  dependencies: {
    database?: DalDatabase;
    requireSession?: () => Promise<Session>;
    limiter?: RateLimiter;
  } = {},
) {
  return async function searchParticipants(
    query: unknown,
  ): Promise<ParticipantSearchResult[]> {
    const session = await (dependencies.requireSession ?? requireSession)();
    const limits = dependencies.limiter ?? limiter;
    const all = limits.consume(
      `participants:all:${session.userId}`,
      30,
      60_000,
    );
    if (!all.allowed) throw new RateLimitError(all.retryAfter);
    if (typeof query === "string" && query.includes("@")) {
      const email = limits.consume(
        `participants:email:${session.userId}`,
        10,
        60_000,
      );
      if (!email.allowed) throw new RateLimitError(email.retryAfter);
    }
    const parsed = participantQuerySchema.safeParse(query);
    if (!parsed.success) return [];
    const rows = await findParticipants(
      session.userId,
      parsed.data,
      dependencies.database,
    );
    return rows.map(({ email, ...person }) => ({
      ...person,
      maskedEmail: maskParticipantEmail(email),
    }));
  };
}
