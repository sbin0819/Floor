import { z } from "zod";
import { createAction } from "@/lib/actions/create-action";
import { evictCalls, evictTargetCalls } from "@/lib/calls/evict";
import { ActionError } from "@/lib/actions/result";
import { isSpaceAdmin } from "@/lib/dal/chat-access";
import {
  banCommunityMember,
  changeTextChannel,
  insertTextChannel,
  readChannelSpace,
  unbanCommunityMember,
} from "@/lib/dal/chat-channel-write";
import { lockChatSpace } from "@/lib/dal/chat-space-write";
import { lockUsersForKeyShare } from "@/lib/dal/chat-write";
import { withTransaction } from "@/lib/dal/database";
import type { ChatActionDependencies } from "./action-factory";
import { publishSpaceEvents, reauthorize, spaceChanged } from "./space-events";
import {
  channelNameSchema,
  channelTopicSchema,
  spaceIdSchema,
  spaceMemberSchema,
} from "./space-schema";

const roomInput = z.strictObject({ roomId: z.uuid() });
const channelFields = {
  name: channelNameSchema.optional(),
  topic: channelTopicSchema.optional(),
  adminOnly: z.boolean().optional(),
};
function requireAdmin(
  state: Awaited<ReturnType<typeof lockChatSpace>>,
  communityOnly = false,
) {
  if (
    !isSpaceAdmin(state.role) ||
    (communityOnly && state.space.kind !== "community")
  )
    throw new ActionError("FORBIDDEN");
}

export function createChannelActions(
  dependencies: ChatActionDependencies = {},
) {
  const now = () => dependencies.now?.() ?? new Date();
  return {
    createChannel: createAction(
      {
        input: spaceIdSchema.extend({
          ...channelFields,
          name: channelNameSchema,
        }),
        authorize: "none",
        async handler({ session, input }) {
          const result = await withTransaction(async (tx) => {
            await lockUsersForKeyShare([session.userId], tx);
            requireAdmin(
              await lockChatSpace(input.spaceId, session.userId, tx),
            );
            return insertTextChannel({ ...input, now: now() }, tx);
          }, dependencies.database);
          await publishSpaceEvents([spaceChanged(input.spaceId)], dependencies);
          return result;
        },
      },
      dependencies,
    ),
    updateChannel: createAction(
      {
        input: roomInput
          .extend(channelFields)
          .refine(
            (input) =>
              input.name !== undefined ||
              input.topic !== undefined ||
              input.adminOnly !== undefined,
          ),
        authorize: "none",
        async handler({ session, input }) {
          const spaceId = await withTransaction(async (tx) => {
            const spaceId = await readChannelSpace(input.roomId, tx);
            await lockUsersForKeyShare([session.userId], tx);
            requireAdmin(await lockChatSpace(spaceId, session.userId, tx));
            await changeTextChannel(
              input.roomId,
              spaceId,
              {
                name: input.name,
                topic: input.topic,
                adminOnly: input.adminOnly,
              },
              tx,
            );
            return spaceId;
          }, dependencies.database);
          await publishSpaceEvents([spaceChanged(spaceId)], dependencies);
          return {};
        },
      },
      dependencies,
    ),
    archiveChannel: createAction(
      {
        input: roomInput,
        authorize: "none",
        async handler({ session, input }) {
          const result = await withTransaction(async (tx) => {
            const spaceId = await readChannelSpace(input.roomId, tx);
            await lockUsersForKeyShare([session.userId], tx);
            requireAdmin(await lockChatSpace(spaceId, session.userId, tx));
            const changed = await changeTextChannel(
              input.roomId,
              spaceId,
              { archivedAt: now() },
              tx,
            );
            return { spaceId, changed };
          }, dependencies.database);
          if (result.changed)
            await evictTargetCalls({ roomId: input.roomId }, dependencies);
          if (result.changed)
            await publishSpaceEvents(
              [spaceChanged(result.spaceId)],
              dependencies,
            );
          return {};
        },
      },
      dependencies,
    ),
    banSpaceMember: createAction(
      {
        input: spaceMemberSchema,
        authorize: "none",
        async handler({ session, input }) {
          await withTransaction(async (tx) => {
            await lockUsersForKeyShare([session.userId, input.userId], tx);
            const state = await lockChatSpace(
              input.spaceId,
              session.userId,
              tx,
            );
            requireAdmin(state, true);
            const target = state.members.find(
              (member) =>
                member.userId === input.userId.toLowerCase() &&
                member.status === "active",
            );
            if (!target) throw new ActionError("NOT_FOUND");
            if (target.userId === session.userId || target.role === "owner")
              throw new ActionError("INVALID_INPUT");
            if (target.role === "admin" && state.role !== "owner")
              throw new ActionError("FORBIDDEN");
            await banCommunityMember(input.spaceId, input.userId, now(), tx);
          }, dependencies.database);
          await evictCalls(input.userId, dependencies);
          await publishSpaceEvents(
            [spaceChanged(input.spaceId), reauthorize(input.userId)],
            dependencies,
          );
          return {};
        },
      },
      dependencies,
    ),
    unbanSpaceMember: createAction(
      {
        input: spaceMemberSchema,
        authorize: "none",
        async handler({ session, input }) {
          await withTransaction(async (tx) => {
            await lockUsersForKeyShare([session.userId, input.userId], tx);
            requireAdmin(
              await lockChatSpace(input.spaceId, session.userId, tx),
              true,
            );
            await unbanCommunityMember(input.spaceId, input.userId, tx);
          }, dependencies.database);
          await publishSpaceEvents([spaceChanged(input.spaceId)], dependencies);
          return {};
        },
      },
      dependencies,
    ),
  };
}
