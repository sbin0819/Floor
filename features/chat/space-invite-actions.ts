import { z } from "zod";
import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { withTransaction } from "@/lib/dal/database";
import { lockMessageUsers, lockUsersForKeyShare } from "@/lib/dal/chat-write";
import { isSpaceAdmin } from "@/lib/dal/chat-access";
import { lockChatSpace } from "@/lib/dal/chat-space-write";
import * as invites from "@/lib/dal/chat-space-invites";
import { getEnv } from "@/lib/env";
import { spaceInviteLimiter } from "@/lib/rate-limit/space-invites";
import { userChannel } from "@/lib/realtime/channels";
import type { RealtimeItem } from "@/lib/realtime/types";
import type { ChatActionDependencies } from "./action-factory";
import { publishSpaceEvents, reauthorize, spaceChanged } from "./space-events";
import {
  createInviteLinkSchema,
  inviteCodePattern,
  inviteToSpaceSchema,
} from "./space-invite-schema";

type Dependencies = ChatActionDependencies & {
  createCode?: () => string;
  baseUrl?: string;
};
const notificationsChanged = (userId: string): RealtimeItem => ({
  channel: userChannel(userId),
  event: { type: "notifications.changed" },
});
export function createSpaceInviteActions(dependencies: Dependencies = {}) {
  const now = () => dependencies.now?.() ?? new Date();
  const createCode =
    dependencies.createCode ??
    (() =>
      Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
        "base64url",
      ));
  return {
    createInviteLink: createAction(
      {
        input: createInviteLinkSchema,
        authorize: "none",
        async handler({ input, session }) {
          const at = now();
          const invite = await withTransaction(async (tx) => {
            await lockMessageUsers(session.userId, [], tx);
            const state = await lockChatSpace(
              input.spaceId,
              session.userId,
              tx,
            );
            if (state.space.kind !== "community")
              throw new ActionError("FORBIDDEN");
            if (
              (await invites.countRecentInvites(
                session.userId,
                at,
                tx,
                input.spaceId,
              )) >= 20
            )
              throw new ActionError("LIMIT_EXCEEDED", {
                message: "invite_count",
              });
            const [created] = await invites.insertSpaceInvites(
              [
                {
                  spaceId: input.spaceId,
                  code: createCode(),
                  createdBy: session.userId,
                  maxUses: input.maxUses,
                  expiresAt:
                    input.expiresIn === "never"
                      ? null
                      : new Date(
                          at.getTime() +
                            (input.expiresIn === "1d" ? 1 : 7) * 86_400_000,
                        ),
                  createdAt: at,
                },
              ],
              tx,
            );
            return created!;
          }, dependencies.database);
          return {
            inviteId: invite.id,
            code: invite.code,
            url: new URL(
              `/s/join/${invite.code}`,
              dependencies.baseUrl ?? getEnv().NEXT_PUBLIC_APP_URL,
            ).href,
          };
        },
      },
      dependencies,
    ),
    revokeInvite: createAction(
      {
        input: z.strictObject({ inviteId: z.uuid() }),
        authorize: "none",
        async handler({ input, session }) {
          const events = await withTransaction(async (tx) => {
            await lockUsersForKeyShare([session.userId], tx);
            const target = await invites.getInviteTarget(input.inviteId, tx);
            if (!target) throw new ActionError("NOT_FOUND");
            const state = await lockChatSpace(
              target.spaceId,
              session.userId,
              tx,
            );
            if (state.space.kind !== "community")
              throw new ActionError("NOT_FOUND");
            const invite = await invites.lockInvite(input.inviteId, tx);
            if (
              !isSpaceAdmin(state.role) &&
              invite.createdBy !== session.userId
            )
              throw new ActionError("FORBIDDEN");
            await invites.revokeSpaceInvite(invite.id, now(), tx);
            const removed = await invites.deleteInviteNotifications(
              [invite.code],
              tx,
            );
            return [...new Set(removed.map(({ userId }) => userId))].map(
              notificationsChanged,
            );
          }, dependencies.database);
          await publishSpaceEvents(events, dependencies);
          return {};
        },
      },
      dependencies,
    ),
    inviteToSpace: createAction(
      {
        input: inviteToSpaceSchema,
        authorize: "none",
        async handler({ input, session }) {
          const at = now();
          const recipients = await withTransaction(async (tx) => {
            await lockMessageUsers(session.userId, input.userIds, tx);
            const state = await lockChatSpace(
              input.spaceId,
              session.userId,
              tx,
            );
            if (state.space.kind !== "community")
              throw new ActionError("FORBIDDEN");
            const targets = await invites.readDirectInviteTargets(
              input.spaceId,
              session.userId,
              input.userIds,
              at,
              tx,
            );
            if (targets.length !== input.userIds.length)
              throw new ActionError("NOT_FOUND");
            const send = targets.filter((target) => !target.skip);
            if (send.some((target) => !target.eligible))
              throw new ActionError("FORBIDDEN");
            if (!send.length) return [];
            if (
              (await invites.countRecentInvites(session.userId, at, tx)) +
                send.length >
              50
            )
              throw new ActionError("LIMIT_EXCEEDED", {
                message: "invite_count",
              });
            const ids = send.map(({ userId }) => userId);
            const reusable = await invites.readReusableInvites(
              input.spaceId,
              ids,
              at,
              tx,
            );
            const selected = new Map<string, (typeof reusable)[number]>();
            for (const invite of reusable)
              if (invite.targetUserId && !selected.has(invite.targetUserId))
                selected.set(invite.targetUserId, invite);
            const created = await invites.insertSpaceInvites(
              ids
                .filter((id) => !selected.has(id))
                .map((userId) => ({
                  spaceId: input.spaceId,
                  code: createCode(),
                  createdBy: session.userId,
                  targetUserId: userId,
                  maxUses: 1,
                  expiresAt: new Date(at.getTime() + 7 * 86_400_000),
                  createdAt: at,
                })),
              tx,
            );
            for (const invite of created)
              selected.set(invite.targetUserId!, invite);
            await invites.insertInviteNotifications(
              ids.map((userId) => {
                const invite = selected.get(userId)!;
                return {
                  userId,
                  type: "space_invite",
                  actorId: session.userId,
                  bookingId: null,
                  data: {
                    actorName: session.name,
                    spaceName: state.space.name!,
                    inviteCode: invite.code,
                  },
                  scheduledFor: at,
                  expiresAt: invite.expiresAt,
                };
              }),
              tx,
            );
            return ids;
          }, dependencies.database);
          await publishSpaceEvents(
            recipients.map(notificationsChanged),
            dependencies,
          );
          return { sent: recipients.length };
        },
      },
      dependencies,
    ),
    joinSpaceByInvite: createAction(
      {
        input: z.strictObject({ code: z.string() }),
        authorize: "none",
        async handler({ input, session }) {
          if (
            !(dependencies.limiter ?? spaceInviteLimiter).consume(
              `space-invite:${session.userId}`,
              30,
              3_600_000,
            ).allowed
          )
            throw new ActionError("LIMIT_EXCEEDED");
          if (!inviteCodePattern.test(input.code))
            throw new ActionError("INVITE_INVALID");
          const at = now();
          const result = await withTransaction(async (tx) => {
            await lockMessageUsers(session.userId, [], tx);
            const target = await invites.getInviteCodeTarget(input.code, tx);
            if (!target) throw new ActionError("INVITE_INVALID");
            await invites.lockSpaceForInvite(
              target.spaceId,
              session.userId,
              tx,
            );
            await invites.lockInvite(target.id, tx);
            const resolution = await invites.readInviteResolution(
              input.code,
              session.userId,
              at,
              tx,
            );
            if (!resolution) throw new ActionError("INVITE_INVALID");
            if (resolution.member)
              return {
                spaceId: target.spaceId,
                changed: false,
                notificationChanged: false,
              };
            const notificationChanged = await invites.joinInvitedSpace(
              target.id,
              target.spaceId,
              session.userId,
              at,
              tx,
            );
            return {
              spaceId: target.spaceId,
              changed: true,
              notificationChanged,
            };
          }, dependencies.database);
          if (result.changed)
            await publishSpaceEvents(
              [
                spaceChanged(result.spaceId),
                reauthorize(session.userId),
                ...(result.notificationChanged
                  ? [notificationsChanged(session.userId)]
                  : []),
              ],
              dependencies,
            );
          return { spaceId: result.spaceId };
        },
      },
      dependencies,
    ),
  };
}
