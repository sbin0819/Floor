import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { evictCalls } from "@/lib/calls/evict";
import { deleteMessageAttachments } from "@/lib/dal/chat-attachments";
import { banCommunityMember } from "@/lib/dal/chat-channel-write";
import {
  deleteChatMessage,
  lockChatMessage,
} from "@/lib/dal/chat-message-write";
import { lockRoomForMessage, lockUsersForKeyShare } from "@/lib/dal/chat-write";
import { withTransaction } from "@/lib/dal/database";
import {
  lockOpenMessageReports,
  lockReportMember,
  lockReportSpace,
  readReportTarget,
  resolveMessageReports,
} from "@/lib/dal/reports-write";
import { can } from "@/lib/permissions/can";
import { loadPermissionContext } from "@/lib/permissions/context";
import { loungeAccessFrom } from "@/lib/permissions/lounge";
import { roomChannel } from "@/lib/realtime/channels";
import { getRealtimePublisher } from "@/lib/realtime/server";
import type { RealtimeItem } from "@/lib/realtime/types";
import { getFileStorage } from "@/lib/storage";
import type { ChatActionDependencies } from "@/features/chat/action-factory";
import { reauthorize, spaceChanged } from "@/features/chat/space-events";
import { resolveReportsSchema } from "./report-schema";

export type ReportActionDependencies = Pick<
  ChatActionDependencies,
  | "database"
  | "getSession"
  | "now"
  | "publisher"
  | "storage"
  | "livekit"
  | "logError"
>;

export function createReportActions(
  dependencies: ReportActionDependencies = {},
) {
  const safely = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch {
      try {
        (dependencies.logError ?? console.error)(
          "Report post-commit operation failed.",
        );
      } catch {
        // 로그 실패도 이미 완료한 처리를 실패로 바꾸지 않는다.
      }
    }
  };
  const publish = (events: RealtimeItem[]) =>
    safely(() =>
      (dependencies.publisher ?? getRealtimePublisher()).publishMany(events),
    );
  return {
    resolveReports: createAction(
      {
        input: resolveReportsSchema,
        authorize: "none",
        async handler({ session, input }) {
          const target = await readReportTarget(
            input.messageId,
            session.userId,
            dependencies.database,
          );
          if (!target) throw new ActionError("NOT_FOUND");
          const result = await withTransaction(async (tx) => {
            const users = await lockUsersForKeyShare(
              [session.userId, target.authorId],
              tx,
            );
            if (
              users.length !== new Set([session.userId, target.authorId]).size
            )
              throw new ActionError("NOT_FOUND");
            if (target.spaceId) {
              if (
                !(await lockReportSpace(
                  {
                    spaceId: target.spaceId,
                    branchId: target.branchId,
                    ban: input.resolution === "member_banned",
                  },
                  tx,
                ))
              )
                throw new ActionError("NOT_FOUND");
              await lockReportMember(target.spaceId, target.authorId, tx);
            }
            await lockRoomForMessage(target.roomId, tx);
            const message = await lockChatMessage(input.messageId, tx);
            if (
              !message ||
              message.kind !== "text" ||
              message.roomId !== target.roomId ||
              message.authorId !== target.authorId
            )
              throw new ActionError("NOT_FOUND");
            const [fresh, context] = await Promise.all([
              readReportTarget(input.messageId, session.userId, tx),
              loadPermissionContext(session, target.branchId, tx),
            ]);
            if (
              !fresh ||
              fresh.branchId !== target.branchId ||
              fresh.spaceId !== target.spaceId
            )
              throw new ActionError("NOT_FOUND");
            if (!can(context, "branch.announce", { branchId: target.branchId }))
              throw new ActionError("FORBIDDEN");
            const open = await lockOpenMessageReports(input.messageId, tx);
            if (!open.length) throw new ActionError("NOT_FOUND");
            if (
              input.resolution === "member_banned" &&
              (!target.spaceId ||
                target.authorId === session.userId ||
                loungeAccessFrom({
                  isStaff: fresh.authorIsStaff,
                  roleSettings: context.roleSettings[target.branchId] ?? {},
                }).isAdmin)
            )
              throw new ActionError("INVALID_INPUT");
            const now = dependencies.now?.() ?? new Date();
            const deleted =
              input.resolution !== "dismissed" &&
              (await deleteChatMessage(
                {
                  id: input.messageId,
                  userId: session.userId,
                  admin: true,
                  now,
                },
                tx,
              ));
            const attachments = deleted
              ? await deleteMessageAttachments(
                  input.messageId,
                  target.roomId,
                  tx,
                )
              : [];
            const banned =
              input.resolution === "member_banned" && target.spaceId
                ? await banCommunityMember(
                    target.spaceId,
                    target.authorId,
                    now,
                    tx,
                    { kind: "branch" },
                  )
                : false;
            const resolved = await resolveMessageReports(
              {
                ids: open.map(({ id }) => id),
                messageId: input.messageId,
                operatorId: session.userId,
                resolution: input.resolution,
                now,
              },
              tx,
            );
            if (resolved.length !== open.length)
              throw new ActionError("NOT_FOUND");
            return { deleted, banned, attachments, seq: message.seq };
          }, dependencies.database);
          await Promise.all([
            ...(result.deleted
              ? [
                  publish([
                    {
                      channel: roomChannel(target.roomId),
                      event: {
                        type: "message.deleted",
                        roomId: target.roomId,
                        id: input.messageId,
                        seq: result.seq,
                      },
                    },
                  ]),
                ]
              : []),
            ...result.attachments.map(({ storageKey }) =>
              safely(() =>
                (dependencies.storage ?? getFileStorage()).remove(storageKey),
              ),
            ),
            ...(result.banned && target.spaceId
              ? [
                  publish([spaceChanged(target.spaceId)]),
                  publish([reauthorize(target.authorId)]),
                  safely(() => evictCalls(target.authorId, dependencies)),
                ]
              : []),
          ]);
          return { messageId: input.messageId };
        },
      },
      dependencies,
    ),
  };
}
