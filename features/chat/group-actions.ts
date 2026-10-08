import { z } from "zod";
import { createAction } from "@/lib/actions/create-action";
import { evictCalls } from "@/lib/calls/evict";
import { ActionError } from "@/lib/actions/result";
import { withTransaction, type DalDatabase } from "@/lib/dal/database";
import {
  activateGroupMembers,
  archiveGroup,
  insertGroupRoom,
  leaveGroupMember,
  lockedGroup,
  requireGroupCandidates,
  updateGroupName,
} from "@/lib/dal/group-dm";
import {
  insertSystemMessage,
  lockRoomForMessage,
  lockRoomMembers,
  lockUsersForKeyShare,
} from "@/lib/dal/chat-write";
import { roomChannel, userChannel } from "@/lib/realtime/channels";
import { getRealtimePublisher } from "@/lib/realtime/server";
import type { RealtimeItem } from "@/lib/realtime/types";
import type { ChatActionDependencies } from "./action-factory";
import type { ChatMessage } from "./types";
import { groupNameSchema } from "./group-name";

const userIds = (minimum: number) =>
  z
    .array(z.uuid().transform((id) => id.toLowerCase()))
    .transform((ids) => [...new Set(ids)])
    .pipe(z.array(z.string()).min(minimum).max(9));
const roomInput = z.strictObject({ roomId: z.uuid() });

async function requireGroup(
  roomId: string,
  userId: string,
  database: DalDatabase,
  allowArchived = false,
) {
  const room = await lockedGroup(roomId, database);
  if (!room) throw new ActionError("NOT_FOUND");
  const members = await lockRoomMembers(roomId, database);
  if (
    !members.some(
      (member) => member.userId === userId && member.status === "active",
    )
  )
    throw new ActionError("NOT_FOUND");
  if (room.archivedAt && !allowArchived) throw new ActionError("FORBIDDEN");
  return { room, members };
}

function groupEvents(
  roomId: string,
  message: ChatMessage,
  recipientIds: readonly string[],
  changed = true,
): RealtimeItem[] {
  return [
    ...(changed
      ? [
          {
            channel: roomChannel(roomId),
            event: { type: "room.changed" as const, roomId },
          },
        ]
      : []),
    ...recipientIds.map((userId) => ({
      channel: userChannel(userId),
      event: {
        type: "room.activity" as const,
        bookingId: null,
        roomId,
        roomKind: "group_dm" as const,
        spaceId: null,
        seq: message.seq,
        authorId: null,
        preview: {
          messageId: message.id,
          authorName: null,
          excerpt: message.body,
        },
      },
    })),
  ];
}

export function createGroupActions(dependencies: ChatActionDependencies) {
  const publish = async (events: RealtimeItem[]) => {
    if (!events.length) return;
    try {
      await (dependencies.publisher ?? getRealtimePublisher()).publishMany(
        events,
      );
    } catch {
      (dependencies.logError ?? console.error)(
        "Chat realtime publication failed.",
      );
    }
  };
  return {
    createGroupDm: createAction(
      {
        input: z.strictObject({
          userIds: userIds(2),
          name: groupNameSchema.optional(),
        }),
        authorize: "none",
        async handler({ session, input }) {
          if (input.userIds.includes(session.userId))
            throw new ActionError("INVALID_INPUT");
          const now = dependencies.now?.() ?? new Date();
          const result = await withTransaction(async (tx) => {
            await lockUsersForKeyShare([session.userId, ...input.userIds], tx);
            await requireGroupCandidates(session.userId, input.userIds, tx);
            const room = await insertGroupRoom(input.name ?? null, now, tx);
            await lockRoomForMessage(room.id, tx);
            await activateGroupMembers(
              room.id,
              [session.userId, ...input.userIds],
              now,
              tx,
            );
            const message = await insertSystemMessage(
              {
                roomId: room.id,
                actorId: session.userId,
                data: { type: "group_created", actorName: session.name },
                now,
              },
              tx,
            );
            return {
              roomId: room.id,
              events: groupEvents(room.id, message, input.userIds, false),
            };
          }, dependencies.database);
          await publish(result.events);
          return { roomId: result.roomId };
        },
      },
      dependencies,
    ),
    addGroupMembers: createAction(
      {
        input: roomInput.extend({ userIds: userIds(1) }),
        authorize: "none",
        async handler({ session, input }) {
          const now = dependencies.now?.() ?? new Date();
          const events = await withTransaction(async (tx) => {
            await lockUsersForKeyShare([session.userId, ...input.userIds], tx);
            const { members } = await requireGroup(
              input.roomId,
              session.userId,
              tx,
            );
            const active = members
              .filter((member) => member.status === "active")
              .map((member) => member.userId);
            const added = input.userIds.filter((id) => !active.includes(id));
            if (!added.length) return [];
            const people = await requireGroupCandidates(
              session.userId,
              added,
              tx,
            );
            if (active.length + added.length > 10)
              throw new ActionError("LIMIT_EXCEEDED");
            await activateGroupMembers(input.roomId, added, now, tx);
            const message = await insertSystemMessage(
              {
                roomId: input.roomId,
                actorId: session.userId,
                data: {
                  type: "members_added",
                  actorName: session.name,
                  names: people.map((person) => person.name),
                },
                now,
              },
              tx,
            );
            return groupEvents(
              input.roomId,
              message,
              [...active, ...added].filter((id) => id !== session.userId),
            );
          }, dependencies.database);
          await publish(events);
          return {};
        },
      },
      dependencies,
    ),
    leaveGroupDm: createAction(
      {
        input: roomInput,
        authorize: "none",
        async handler({ session, input }) {
          const now = dependencies.now?.() ?? new Date();
          const events = await withTransaction(async (tx) => {
            await lockUsersForKeyShare([session.userId], tx);
            const { members } = await requireGroup(
              input.roomId,
              session.userId,
              tx,
              true,
            );
            if (
              !(await leaveGroupMember(input.roomId, session.userId, now, tx))
                .length
            )
              throw new ActionError("NOT_FOUND");
            const remaining = members
              .filter(
                (member) =>
                  member.userId !== session.userId &&
                  member.status === "active",
              )
              .map((member) => member.userId);
            const message = await insertSystemMessage(
              {
                roomId: input.roomId,
                data: { type: "member_left", name: session.name },
                now,
              },
              tx,
            );
            if (!remaining.length) await archiveGroup(input.roomId, now, tx);
            return [
              ...groupEvents(input.roomId, message, remaining),
              {
                channel: userChannel(session.userId),
                event: { type: "realtime.reauth" as const },
              },
            ];
          }, dependencies.database);
          await evictCalls(session.userId, dependencies);
          await publish(events);
          return {};
        },
      },
      dependencies,
    ),
    renameGroupDm: createAction(
      {
        input: roomInput.extend({ name: groupNameSchema }),
        authorize: "none",
        async handler({ session, input }) {
          const now = dependencies.now?.() ?? new Date();
          const events = await withTransaction(async (tx) => {
            await lockUsersForKeyShare([session.userId], tx);
            const { room, members } = await requireGroup(
              input.roomId,
              session.userId,
              tx,
            );
            if (room.name === input.name) return [];
            await updateGroupName(input.roomId, input.name, tx);
            const message = await insertSystemMessage(
              {
                roomId: input.roomId,
                actorId: session.userId,
                data: {
                  type: "room_renamed",
                  actorName: session.name,
                  name: input.name,
                },
                now,
              },
              tx,
            );
            return groupEvents(
              input.roomId,
              message,
              members
                .filter(
                  (member) =>
                    member.userId !== session.userId &&
                    member.status === "active",
                )
                .map((member) => member.userId),
            );
          }, dependencies.database);
          await publish(events);
          return {};
        },
      },
      dependencies,
    ),
  };
}
