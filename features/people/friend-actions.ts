import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { withTransaction, type DalDatabase } from "@/lib/dal/database";
import * as friends from "@/lib/dal/friends";
import * as locks from "@/lib/dal/people-write";
import { blockBetween } from "@/lib/dal/people-blocks";
import {
  createPersonNotification,
  deleteFriendRequestNotification,
} from "@/lib/dal/notifications";
import { FRIEND_DAY_MS, relationOf } from "@/lib/people/friendship";
import { userChannel } from "@/lib/realtime/channels";
import { getRealtimePublisher } from "@/lib/realtime/server";
import type { RealtimeItem, RealtimePublisher } from "@/lib/realtime/types";
import { personTargetSchema, respondFriendSchema } from "./schema";
import type { PersonRelation } from "./types";
import type { PeopleActionDependencies } from "./username";

type Dependencies = PeopleActionDependencies & {
  publisher?: RealtimePublisher;
};
type FriendOperation = "send" | "accept" | "decline" | "cancel" | "remove";

export function createFriendActions(dependencies: Dependencies = {}) {
  async function perform(
    me: string,
    other: string,
    operation: FriendOperation,
  ) {
    if (me === other) throw new ActionError("INVALID_INPUT");
    const now = dependencies.now?.() ?? new Date();
    const outcome = await withTransaction(async (tx) => {
      const people = await locks.lockFriendUsers(me, other, tx);
      if (!people.me || !people.other?.emailVerified)
        throw new ActionError("NOT_FOUND");
      if (operation === "send" || operation === "accept") {
        const blocks = await blockBetween(me, other, tx);
        if (blocks.byMe || blocks.byThem) throw new ActionError("FORBIDDEN");
      }
      let row = await locks.lockFriendPair(me, other, tx);
      const events: RealtimeItem[] = [];
      const changed = (userId: string, notification = false) => {
        const channel = userChannel(userId);
        events.push({ channel, event: { type: "friend.changed" } });
        if (notification)
          events.push({ channel, event: { type: "notifications.changed" } });
      };
      const result = (relation: PersonRelation) => ({ relation, events });
      const requireChange = async (
        current: friends.FriendshipRow,
        status: friends.FriendshipRow["status"],
        restart = false,
      ) => {
        const next = await friends.changeFriendship(
          current,
          {
            status,
            statusChangedAt: now,
            ...(restart ? { requestedBy: me, requestedAt: now } : {}),
          },
          tx,
        );
        if (!next) throw new ActionError("NOT_FOUND");
      };
      const removeRequest = (recipient: string, actor: string) =>
        deleteFriendRequestNotification(recipient, actor, tx);
      const notifyOther = (type: "friend_request" | "friend_accepted") =>
        createPersonNotification(
          { userId: other, type, actorId: me, actorName: people.me!.name, now },
          tx,
        );
      const accept = async (current: friends.FriendshipRow) => {
        await requireChange(current, "accepted");
        const deleted = await removeRequest(me, other);
        await notifyOther("friend_accepted");
        changed(me, deleted.length > 0);
        changed(other, true);
        return result("friend");
      };

      if (operation === "send") {
        if (!row) {
          const inserted = await friends.insertFriendRequest(
            me,
            other,
            now,
            tx,
          );
          if (inserted) {
            await checkDailyLimit(me, other, now, tx);
            await notifyOther("friend_request");
            changed(me);
            changed(other, true);
            return result("outgoing");
          }
          // 유일 제약 경합은 오류로 드러내지 않고 잠근 최신 관계의 상태표를 다시 적용한다.
          row = await locks.lockFriendPair(me, other, tx);
          if (!row) throw new ActionError("NOT_FOUND");
        }
        const relation = relationOf(row, me, now);
        if (relation === "friend" || relation === "outgoing")
          return result(relation);
        if (relation === "incoming") return accept(row);
        if (
          row.status === "cancelled" &&
          row.requestedBy === me &&
          row.statusChangedAt.getTime() > now.getTime() - FRIEND_DAY_MS
        )
          throw new ActionError("LIMIT_EXCEEDED", {
            message: "friend_cooldown",
          });
        await checkDailyLimit(me, other, now, tx);
        await requireChange(row, "pending", true);
        await notifyOther("friend_request");
        changed(me);
        changed(other, true);
        return result("outgoing");
      }

      if (operation === "accept" || operation === "decline") {
        if (!row || row.status !== "pending" || row.requestedBy !== other)
          throw new ActionError("NOT_FOUND");
        if (operation === "accept") return accept(row);
        await requireChange(row, "declined");
        const deleted = await removeRequest(me, other);
        changed(me, deleted.length > 0);
        return result("none");
      }
      if (operation === "cancel") {
        if (!row || relationOf(row, me, now) !== "outgoing")
          throw new ActionError("NOT_FOUND");
        await requireChange(row, "cancelled");
        if (row.status === "pending") {
          await removeRequest(other, me);
          changed(other, true);
        }
        changed(me);
        return result("none");
      }
      if (!row || row.status !== "accepted") throw new ActionError("NOT_FOUND");
      if (!(await friends.deleteFriendship(row, tx)))
        throw new ActionError("NOT_FOUND");
      changed(me);
      changed(other);
      return result("none");
    }, dependencies.database);

    if (outcome.events.length)
      try {
        await (dependencies.publisher ?? getRealtimePublisher()).publishMany(
          outcome.events,
        );
      } catch {
        (dependencies.logError ?? console.error)(
          "Friend realtime publication failed.",
        );
      }
    return { relation: outcome.relation };
  }

  return {
    sendFriendRequest: createAction(
      {
        input: personTargetSchema,
        authorize: "none",
        handler: ({ session, input }) =>
          perform(session.userId, input.userId, "send"),
      },
      dependencies,
    ),
    respondFriendRequest: createAction(
      {
        input: respondFriendSchema,
        authorize: "none",
        handler: ({ session, input }) =>
          perform(
            session.userId,
            input.userId,
            input.accept ? "accept" : "decline",
          ),
      },
      dependencies,
    ),
    cancelFriendRequest: createAction(
      {
        input: personTargetSchema,
        authorize: "none",
        handler: ({ session, input }) =>
          perform(session.userId, input.userId, "cancel"),
      },
      dependencies,
    ),
    removeFriend: createAction(
      {
        input: personTargetSchema,
        authorize: "none",
        handler: ({ session, input }) =>
          perform(session.userId, input.userId, "remove"),
      },
      dependencies,
    ),
  };
}

async function checkDailyLimit(
  me: string,
  other: string,
  now: Date,
  tx: DalDatabase,
) {
  if ((await friends.countRecentFriendRequests(me, other, now, tx)) >= 20)
    throw new ActionError("LIMIT_EXCEEDED", { message: "friend_daily" });
}
