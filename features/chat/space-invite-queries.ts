import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";
import { ActionError } from "@/lib/actions/result";
import { canReadSpace } from "@/lib/dal/chat-access";
import type { DalDatabase } from "@/lib/dal/database";
import {
  listInviteCandidates,
  listSpaceInvites,
  readInviteResolution,
} from "@/lib/dal/chat-space-invites";
import { RateLimitError, type RateLimiter } from "@/lib/rate-limit/memory";
import { spaceInviteLimiter } from "@/lib/rate-limit/space-invites";
import type { SpaceIconColor } from "./space-schema";
import { inviteCodePattern } from "./space-invite-schema";

export type InvitePreview =
  | { state: "invalid" }
  | { state: "member"; spaceId: string }
  | {
      state: "open";
      spaceName: string;
      iconColor: SpaceIconColor;
      memberCount: number;
    };
export type SpaceInviteItem = {
  inviteId: string;
  codePrefix: string;
  code?: string;
  createdByName: string;
  expiresAt: string | null;
  useCount: number;
  maxUses: number | null;
};
export type InviteCandidate = {
  userId: string;
  name: string;
  username: string | null;
};
type Dependencies = {
  database?: DalDatabase;
  requireSession?: () => Promise<Session>;
  now?: () => Date;
  limiter?: RateLimiter;
};
export function createSpaceInviteQueries(dependencies: Dependencies = {}) {
  const session = dependencies.requireSession ?? requireSession;
  const clock = () => dependencies.now?.() ?? new Date();
  function id(input: unknown) {
    const parsed = z.uuid().safeParse(input);
    if (!parsed.success) throw new ActionError("NOT_FOUND");
    return parsed.data.toLowerCase();
  }
  return {
    async getInvitePreview(code: unknown): Promise<InvitePreview> {
      const me = await session();
      const limit = (dependencies.limiter ?? spaceInviteLimiter).consume(
        `space-invite:${me.userId}`,
        30,
        3_600_000,
      );
      if (!limit.allowed) throw new RateLimitError(limit.retryAfter);
      if (typeof code !== "string" || !inviteCodePattern.test(code))
        return { state: "invalid" };
      const result = await readInviteResolution(
        code,
        me.userId,
        clock(),
        dependencies.database,
      );
      if (!result) return { state: "invalid" };
      return result.member
        ? { state: "member", spaceId: result.spaceId }
        : {
            state: "open",
            spaceName: result.spaceName!,
            iconColor: result.iconColor,
            memberCount: result.memberCount,
          };
    },
    async getSpaceInvites(input: unknown): Promise<SpaceInviteItem[]> {
      const me = await session();
      const spaceId = id(input);
      const [space, rows] = await Promise.all([
        canReadSpace(me.userId, spaceId, dependencies.database),
        listSpaceInvites(spaceId, me.userId, clock(), dependencies.database),
      ]);
      if (!space || space.spaceKind !== "community")
        throw new ActionError("NOT_FOUND");
      return rows.map(({ code, expiresAt, ...row }) => ({
        ...row,
        ...(code === null ? {} : { code }),
        expiresAt: expiresAt?.toISOString() ?? null,
      }));
    },
    async getInviteCandidates(input: unknown): Promise<InviteCandidate[]> {
      const me = await session();
      const spaceId = id(input);
      const [space, rows] = await Promise.all([
        canReadSpace(me.userId, spaceId, dependencies.database),
        listInviteCandidates(spaceId, me.userId, dependencies.database),
      ]);
      if (!space || space.spaceKind !== "community")
        throw new ActionError("NOT_FOUND");
      return rows;
    },
  };
}
export async function getInvitePreview(code: unknown) {
  return createSpaceInviteQueries().getInvitePreview(code);
}
export async function getSpaceInvites(spaceId: unknown) {
  return createSpaceInviteQueries().getSpaceInvites(spaceId);
}
export async function getInviteCandidates(spaceId: unknown) {
  return createSpaceInviteQueries().getInviteCandidates(spaceId);
}
