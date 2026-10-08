import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import {
  createMemoryRateLimiter,
  RateLimitError,
  type RateLimiter,
} from "@/lib/rate-limit/memory";
import * as people from "@/lib/dal/people-read";
import { listMessageRequests } from "@/lib/dal/message-requests-read";
import { excerptOf } from "@/features/chat/message-text";
import { parseUsername } from "@/lib/people/username";
import { peopleSearchSchema, friendsTab } from "./schema";
import { readUsernameSettings, type PeopleQueryDependencies } from "./username";
import type {
  FriendsView,
  MessageContact,
  PersonProfile,
  PersonSearchResult,
  MessageRequestRow,
} from "./types";

const limiter = createMemoryRateLimiter();
export function createPeopleQueries(
  dependencies: PeopleQueryDependencies & { rateLimiter?: RateLimiter } = {},
) {
  const session = dependencies.requireSession ?? requireSession;
  const database = dependencies.database;
  const now = () => dependencies.now?.() ?? new Date();
  function consume(key: string, limit: number, window: number) {
    const result = (dependencies.rateLimiter ?? limiter).consume(
      key,
      limit,
      window,
    );
    if (!result.allowed) throw new RateLimitError(result.retryAfter);
  }
  return {
    async getMessageRequests(): Promise<MessageRequestRow[]> {
      const me = await session();
      const rows = await listMessageRequests(me.userId, database);
      return rows.map((row) => ({
        roomId: row.roomId,
        other: row.other,
        excerpt: excerptOf(
          row.body,
          new Map([
            [me.userId, me.name],
            [row.other.userId, row.other.name],
          ]),
          row.attachmentSummary,
        ),
        lastMessageAt: row.lastMessageAt!.toISOString(),
      }));
    },
    async searchPeople(query: unknown): Promise<PersonSearchResult[]> {
      const me = await session();
      const input = peopleSearchSchema.safeParse(query);
      if (!input.success) throw new ActionError("INVALID_INPUT");
      consume(`people-search:${me.userId}`, 30, 3_600_000);
      return people.searchPeopleRows(
        me.userId,
        { query: input.data, username: parseUsername(input.data) },
        now(),
        database,
      );
    },
    async getPersonProfile(userId: unknown): Promise<PersonProfile> {
      const me = await session();
      consume(`people-profile:${me.userId}`, 60, 60_000);
      const input = z.uuid().safeParse(userId);
      if (!input.success) throw new ActionError("NOT_FOUND");
      const row = await people.readPersonProfile(
        me.userId,
        input.data.toLowerCase(),
        now(),
        database,
      );
      if (!row) throw new ActionError("NOT_FOUND");
      const isMe = row.userId === me.userId;
      return {
        ...row,
        isMe,
        relation: isMe ? null : row.relation,
        canDirectMessage: !isMe && row.canDirectMessage,
      };
    },
    async getFriendsView(tab: unknown): Promise<FriendsView> {
      const me = await session();
      const at = now();
      const [settings, rows] = await Promise.all([
        readUsernameSettings(me, at, database),
        people.readFriendsList(me.userId, friendsTab(tab), at, database),
      ]);
      if (!rows) throw new ActionError("NOT_FOUND");
      return { settings, ...rows };
    },
    async getMessageContacts(options?: {
      rateLimit: true;
    }): Promise<MessageContact[]> {
      const me = await session();
      if (options?.rateLimit)
        consume(`people-contacts:${me.userId}`, 30, 60_000);
      return people.listMessageContacts(me.userId, database);
    },
  };
}
