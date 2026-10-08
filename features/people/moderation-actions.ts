import { createAction } from "@/lib/actions/create-action";
import { evictCalls } from "@/lib/calls/evict";
import type { LiveKitServer } from "@/lib/calls/types";
import { ActionError } from "@/lib/actions/result";
import { withTransaction } from "@/lib/dal/database";
import { canReadRoom } from "@/lib/dal/chat-access";
import {
  findMessageTarget,
  lockChatMessage,
} from "@/lib/dal/chat-message-write";
import { lockRoomForMessage } from "@/lib/dal/chat-write";
import * as friends from "@/lib/dal/friends";
import * as locks from "@/lib/dal/people-write";
import * as moderation from "@/lib/dal/people-moderation";
import { blockBetween } from "@/lib/dal/people-blocks";
import { readPersonProfile } from "@/lib/dal/people-read";
import { userChannel } from "@/lib/realtime/channels";
import { getRealtimePublisher } from "@/lib/realtime/server";
import type { RealtimeItem, RealtimePublisher } from "@/lib/realtime/types";
import {
  personTargetSchema,
  reportMessageSchema,
  reportUserSchema,
} from "./schema";
import type { PeopleActionDependencies } from "./username";

export function createModerationActions(
  dependencies: PeopleActionDependencies & {
    publisher?: RealtimePublisher;
    livekit?: LiveKitServer | null;
  } = {},
) {
  const database = dependencies.database;
  const publish = async (events: RealtimeItem[]) => {
    if (!events.length) return;
    try {
      await (dependencies.publisher ?? getRealtimePublisher()).publishMany(
        events,
      );
    } catch {
      (dependencies.logError ?? console.error)(
        "People realtime publication failed.",
      );
    }
  };
  return {
    blockUser: createAction(
      {
        input: personTargetSchema,
        authorize: "none",
        async handler({ session, input }) {
          const me = session.userId;
          const other = input.userId;
          if (me === other) throw new ActionError("INVALID_INPUT");
          const now = dependencies.now?.() ?? new Date();
          const events = await withTransaction(async (tx) => {
            const people = await locks.lockFriendUsers(me, other, tx);
            if (!people.me || !people.other) throw new ActionError("NOT_FOUND");
            if ((await blockBetween(me, other, tx)).byMe) return [];
            if (!(await readPersonProfile(me, other, now, tx)))
              throw new ActionError("NOT_FOUND");
            const row = await locks.lockFriendPair(me, other, tx);
            if (!(await moderation.insertUserBlock(me, other, now, tx)).length)
              return [];
            const cancelOwn =
              row?.status === "pending" && row.requestedBy === me;
            if (row?.status === "accepted") {
              if (!(await friends.deleteFriendship(row, tx)))
                throw new ActionError("NOT_FOUND");
            } else if (row?.status === "pending") {
              if (
                !(await friends.changeFriendship(
                  row,
                  {
                    status: cancelOwn ? "cancelled" : "declined",
                    statusChangedAt: now,
                  },
                  tx,
                ))
              )
                throw new ActionError("NOT_FOUND");
            }
            await moderation.declineBlockedDirectRequests(me, other, now, tx);
            const deleted = await moderation.deleteBlockedNotifications(
              me,
              other,
              cancelOwn,
              tx,
            );
            const channel = userChannel(me);
            const events: RealtimeItem[] = [
              { channel, event: { type: "friend.changed" } },
            ];
            if (deleted.length)
              events.push({
                channel,
                event: { type: "notifications.changed" },
              });
            return events;
          }, database);
          await Promise.all(
            [me, other].map((userId) => evictCalls(userId, dependencies)),
          );
          await publish(events);
          return {};
        },
      },
      dependencies,
    ),
    unblockUser: createAction(
      {
        input: personTargetSchema,
        authorize: "none",
        async handler({ session, input }) {
          if (session.userId === input.userId)
            throw new ActionError("INVALID_INPUT");
          const changed = await withTransaction(async (tx) => {
            await locks.lockFriendUsers(session.userId, input.userId, tx);
            return (
              (
                await moderation.removeUserBlock(
                  session.userId,
                  input.userId,
                  tx,
                )
              ).length > 0
            );
          }, database);
          if (changed)
            await publish([
              {
                channel: userChannel(session.userId),
                event: { type: "friend.changed" },
              },
            ]);
          return {};
        },
      },
      dependencies,
    ),
    reportUser: createAction(
      {
        input: reportUserSchema,
        authorize: "none",
        async handler({ session, input }) {
          if (session.userId === input.userId)
            throw new ActionError("INVALID_INPUT");
          const now = dependencies.now?.() ?? new Date();
          await withTransaction(async (tx) => {
            await locks.lockFriendUsers(session.userId, input.userId, tx);
            if (
              !(await readPersonProfile(session.userId, input.userId, now, tx))
            )
              throw new ActionError("NOT_FOUND");
            if (
              (await moderation.countRecentReports(session.userId, now, tx)) >=
              20
            )
              throw new ActionError("LIMIT_EXCEEDED", {
                message: "report_daily",
              });
            await moderation.insertReport(
              {
                reporterId: session.userId,
                targetUserId: input.userId,
                reason: input.reason,
                detail: input.detail,
                now,
              },
              tx,
            );
          }, database);
          return {};
        },
      },
      dependencies,
    ),
    reportMessage: createAction(
      {
        input: reportMessageSchema,
        authorize: "none",
        async handler({ session, input }) {
          const target = await findMessageTarget(input.messageId, database);
          if (
            !target ||
            !(await canReadRoom(session.userId, target.roomId, database))
          )
            throw new ActionError("NOT_FOUND");
          if (
            target.authorId === session.userId ||
            target.kind !== "text" ||
            target.deletedAt ||
            target.authorId === null
          )
            throw new ActionError("INVALID_INPUT");
          const now = dependencies.now?.() ?? new Date();
          await withTransaction(async (tx) => {
            await locks.lockFriendUsers(session.userId, target.authorId!, tx);
            await lockRoomForMessage(target.roomId, tx);
            if (!(await canReadRoom(session.userId, target.roomId, tx)))
              throw new ActionError("NOT_FOUND");
            const message = await lockChatMessage(input.messageId, tx);
            if (!message || message.roomId !== target.roomId)
              throw new ActionError("NOT_FOUND");
            if (
              message.kind !== "text" ||
              message.deletedAt ||
              message.authorId === session.userId ||
              message.authorId === null
            )
              throw new ActionError("INVALID_INPUT");
            if (
              await moderation.hasMessageReport(session.userId, message.id, tx)
            )
              return;
            if (
              (await moderation.countRecentReports(session.userId, now, tx)) >=
              20
            )
              throw new ActionError("LIMIT_EXCEEDED", {
                message: "report_daily",
              });
            await moderation.insertReport(
              {
                reporterId: session.userId,
                targetUserId: message.authorId,
                messageId: message.id,
                reason: input.reason,
                detail: input.detail,
                now,
              },
              tx,
            );
          }, database);
          return {};
        },
      },
      dependencies,
    ),
  };
}
