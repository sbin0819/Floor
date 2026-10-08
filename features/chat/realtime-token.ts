import type { TokenParams, TokenRequest } from "ably";
import { z } from "zod";
import { ActionError } from "@/lib/actions/result";
import { requireSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";
import { canReadRoom } from "@/lib/dal/chat-access";
import { listRealtimeSpaces } from "@/lib/dal/chat-presence";
import type { DalDatabase } from "@/lib/dal/database";
import { getEnv } from "@/lib/env";
import {
  createMemoryRateLimiter,
  RateLimitError,
  type RateLimiter,
} from "@/lib/rate-limit/memory";
import { createAblyRestClient } from "@/lib/realtime/ably-server";
import {
  roomChannel,
  spaceChannel,
  userChannel,
} from "@/lib/realtime/channels";

const tokenSchema = z.strictObject({
  rooms: z.array(z.uuid().transform((id) => id.toLowerCase())).max(3),
  // 옛 클라이언트가 보낸 선택은 무시하고 서버 소속으로만 capability를 만든다.
  spaces: z.unknown().optional(),
});
const limiter = createMemoryRateLimiter();
export class RealtimeDisabledError extends Error {}
export type RealtimeTokenDependencies = {
  requireSession?: () => Promise<Session>;
  database?: DalDatabase;
  getKey?: () => string | undefined;
  limiter?: RateLimiter;
  createTokenRequest?: (
    params: TokenParams,
    key: string,
  ) => Promise<TokenRequest>;
};

export function createRealtimeToken(
  dependencies: RealtimeTokenDependencies = {},
) {
  return async (input: unknown | (() => Promise<unknown>)) => {
    const session = await (dependencies.requireSession ?? requireSession)();
    const key = (dependencies.getKey ?? (() => getEnv().ABLY_API_KEY))();
    if (!key) throw new RealtimeDisabledError();
    let body: unknown;
    try {
      body = typeof input === "function" ? await input() : input;
    } catch {
      throw new ActionError("INVALID_INPUT");
    }
    const parsed = tokenSchema.safeParse(body);
    if (!parsed.success) throw new ActionError("INVALID_INPUT");
    const limit = (dependencies.limiter ?? limiter).consume(
      `chat:token:${session.userId}`,
      30,
      60_000,
    );
    if (!limit.allowed) throw new RateLimitError(limit.retryAfter);
    const capability: Record<string, ("subscribe" | "presence")[]> = {
      [userChannel(session.userId)]: ["subscribe"],
    };
    await Promise.all([
      ...[...new Set(parsed.data.rooms)].map(async (roomId) => {
        if (await canReadRoom(session.userId, roomId, dependencies.database))
          capability[roomChannel(roomId)] = ["subscribe", "presence"];
      }),
      listRealtimeSpaces(session.userId, dependencies.database).then(
        (spaces) => {
          for (const { id, kind } of spaces)
            capability[spaceChannel(id)] =
              kind === "branch" ? ["subscribe"] : ["subscribe", "presence"];
        },
      ),
    ]);
    const params: TokenParams = {
      clientId: session.userId,
      ttl: 600_000,
      capability,
    };
    return dependencies.createTokenRequest
      ? dependencies.createTokenRequest(params, key)
      : (await createAblyRestClient(key)).auth.createTokenRequest(params);
  };
}

export const getRealtimeToken = createRealtimeToken();
