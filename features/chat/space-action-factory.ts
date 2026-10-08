import { z } from "zod";
import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { withTransaction } from "@/lib/dal/database";
import { lockMessageUsers, lockUsersForKeyShare } from "@/lib/dal/chat-write";
import {
  deleteSpaceMembership,
  insertCommunity,
  joinBranchLounge,
  lockChatSpace,
  softDeleteCommunity,
  updateCommunity,
  updateSpaceRole,
} from "@/lib/dal/chat-space-write";
import type { ChatActionDependencies } from "./action-factory";
import {
  createCommunitySpaceSchema,
  spaceIdSchema,
  spaceMemberSchema,
  updateSpaceSchema,
} from "./space-schema";
import { publishSpaceEvents, reauthorize, spaceChanged } from "./space-events";

function requireOwner(state: Awaited<ReturnType<typeof lockChatSpace>>) {
  if (state.space.kind !== "community" || state.role !== "owner")
    throw new ActionError("FORBIDDEN");
}

export function createSpaceActions(dependencies: ChatActionDependencies = {}) {
  const clock = () => dependencies.now?.() ?? new Date();
  return {
    joinLounge: createAction(
      {
        input: z.strictObject({ branchId: z.uuid() }),
        authorize: "none",
        async handler({ session, input }) {
          const result = await withTransaction(async (tx) => {
            await lockMessageUsers(session.userId, [], tx);
            return joinBranchLounge(
              input.branchId,
              session.userId,
              clock(),
              tx,
            );
          }, dependencies.database);
          if (result.changed)
            await publishSpaceEvents(
              [reauthorize(session.userId)],
              dependencies,
            );
          return { spaceId: result.spaceId };
        },
      },
      dependencies,
    ),
    createCommunitySpace: createAction(
      {
        input: createCommunitySpaceSchema,
        authorize: "none",
        async handler({ session, input }) {
          const result = await withTransaction(async (tx) => {
            await lockMessageUsers(session.userId, [], tx);
            return insertCommunity(
              { ...input, userId: session.userId, now: clock() },
              tx,
            );
          }, dependencies.database);
          await publishSpaceEvents([reauthorize(session.userId)], dependencies);
          return result;
        },
      },
      dependencies,
    ),
    leaveSpace: createAction(
      {
        input: spaceIdSchema,
        authorize: "none",
        async handler({ session, input }) {
          const events = await withTransaction(async (tx) => {
            await lockUsersForKeyShare([session.userId], tx);
            const { space, role } = await lockChatSpace(
              input.spaceId,
              session.userId,
              tx,
            );
            if (space.kind === "team" || role === "owner")
              throw new ActionError("FORBIDDEN");
            await deleteSpaceMembership(space.id, session.userId, tx);
            return [
              ...(space.kind === "community" ? [spaceChanged(space.id)] : []),
              reauthorize(session.userId),
            ];
          }, dependencies.database);
          await publishSpaceEvents(events, dependencies);
          return {};
        },
      },
      dependencies,
    ),
    updateSpace: createAction(
      {
        input: updateSpaceSchema,
        authorize: "none",
        async handler({ session, input }) {
          await withTransaction(async (tx) => {
            await lockUsersForKeyShare([session.userId], tx);
            requireOwner(
              await lockChatSpace(input.spaceId, session.userId, tx),
            );
            await updateCommunity(
              input.spaceId,
              { name: input.name, iconColor: input.iconColor },
              tx,
            );
          }, dependencies.database);
          await publishSpaceEvents([spaceChanged(input.spaceId)], dependencies);
          return {};
        },
      },
      dependencies,
    ),
    setSpaceAdmin: createAction(
      {
        input: spaceMemberSchema.extend({ admin: z.boolean() }),
        authorize: "none",
        async handler({ session, input }) {
          await withTransaction(async (tx) => {
            await lockUsersForKeyShare([session.userId, input.userId], tx);
            requireOwner(
              await lockChatSpace(input.spaceId, session.userId, tx),
            );
            if (input.userId.toLowerCase() === session.userId.toLowerCase())
              throw new ActionError("INVALID_INPUT");
            await updateSpaceRole(
              input.spaceId,
              input.userId,
              input.admin ? "admin" : "member",
              clock(),
              tx,
            );
          }, dependencies.database);
          await publishSpaceEvents([spaceChanged(input.spaceId)], dependencies);
          return {};
        },
      },
      dependencies,
    ),
    transferSpaceOwnership: createAction(
      {
        input: spaceMemberSchema,
        authorize: "none",
        async handler({ session, input }) {
          const now = clock();
          await withTransaction(async (tx) => {
            await lockUsersForKeyShare([session.userId, input.userId], tx);
            const state = await lockChatSpace(
              input.spaceId,
              session.userId,
              tx,
            );
            requireOwner(state);
            if (input.userId.toLowerCase() === session.userId.toLowerCase())
              throw new ActionError("INVALID_INPUT");
            if (
              !state.members.some(
                (member) =>
                  member.userId === input.userId.toLowerCase() &&
                  member.status === "active",
              )
            )
              throw new ActionError("NOT_FOUND");
            await updateSpaceRole(
              input.spaceId,
              session.userId,
              "admin",
              now,
              tx,
            );
            await updateSpaceRole(
              input.spaceId,
              input.userId,
              "owner",
              now,
              tx,
            );
          }, dependencies.database);
          await publishSpaceEvents([spaceChanged(input.spaceId)], dependencies);
          return {};
        },
      },
      dependencies,
    ),
    deleteSpace: createAction(
      {
        input: spaceIdSchema.extend({ confirmName: z.string() }),
        authorize: "none",
        async handler({ session, input }) {
          const events = await withTransaction(async (tx) => {
            await lockUsersForKeyShare([session.userId], tx);
            const state = await lockChatSpace(
              input.spaceId,
              session.userId,
              tx,
            );
            requireOwner(state);
            if (state.space.name !== input.confirmName)
              throw new ActionError("INVALID_INPUT");
            await softDeleteCommunity(input.spaceId, clock(), tx);
            return [
              spaceChanged(input.spaceId),
              ...state.members
                .filter((member) => member.status === "active")
                .map((member) => reauthorize(member.userId)),
            ];
          }, dependencies.database);
          await publishSpaceEvents(events, dependencies);
          return {};
        },
      },
      dependencies,
    ),
  };
}
