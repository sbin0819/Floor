import { createAction } from "@/lib/actions/create-action";
import { ActionError } from "@/lib/actions/result";
import { withTransaction } from "@/lib/dal/database";
import {
  announcementRecipients,
  loungeAvailability,
  readAnnouncementBranch,
} from "@/lib/dal/announcements-read";
import {
  countDailyAnnouncements,
  insertAnnouncement,
  lockAnnouncementBranch,
  lockAnnouncementRoom,
  lockAnnouncementUsers,
} from "@/lib/dal/announcement-write";
import { joinExistingBranchLounge } from "@/lib/dal/chat-space-write";
import { insertNotifications } from "@/lib/dal/notifications";
import { loadPermissionContext } from "@/lib/permissions/context";
import { userChannel } from "@/lib/realtime/channels";
import { getRealtimePublisher } from "@/lib/realtime/server";
import type { RealtimeItem } from "@/lib/realtime/types";
import { addDays, localDate, zonedDateTime } from "@/lib/time/zoned";
import type { ChatActionDependencies } from "@/features/chat/action-factory";
import { sendLockedMessage } from "@/features/chat/send-message-core";
import { reauthorize } from "@/features/chat/space-events";
import { buildBranchAnnouncementNotifications } from "@/features/notifications/builders";
import {
  requireAnnouncementPermission,
  sendAnnouncementSchema,
  validateAnnouncementAudience,
} from "./announcement-schema";

export type AnnouncementActionDependencies = Pick<
  ChatActionDependencies,
  "database" | "getSession" | "now" | "publisher" | "logError"
>;

function unavailable(): never {
  throw new ActionError("INVALID_INPUT", { message: "lounge_unavailable" });
}

export function createAnnouncementActionFactory(
  dependencies: AnnouncementActionDependencies = {},
) {
  const log = () => {
    try {
      (dependencies.logError ?? console.error)(
        "Announcement operation failed.",
      );
    } catch {
      /* 커밋 뒤 발행과 로그 실패는 저장 결과를 바꾸지 않는다. */
    }
  };
  const publish = async (events: RealtimeItem[]) => {
    if (!events.length) return;
    try {
      await (dependencies.publisher ?? getRealtimePublisher()).publishMany(
        events,
      );
    } catch {
      log();
    }
  };
  return {
    sendAnnouncement: createAction(
      {
        input: sendAnnouncementSchema,
        authorize: "none",
        async handler({ session, input }) {
          const result = await withTransaction(async (tx) => {
            await lockAnnouncementBranch(input.branchId, tx);
            const now = dependencies.now?.() ?? new Date();
            const [metadata, context] = await Promise.all([
              readAnnouncementBranch(
                {
                  branchId: input.branchId,
                  operatorId: session.userId,
                  audience: input.audience,
                },
                tx,
              ),
              loadPermissionContext(session, input.branchId, tx),
            ]);
            if (!metadata) throw new ActionError("NOT_FOUND");
            requireAnnouncementPermission(context, input.branchId);
            const { branch, floors } = metadata;
            const range = validateAnnouncementAudience(input.audience, {
              timezone: branch.timezone,
              floors,
              now,
            });
            const today = localDate(now, branch.timezone);
            const [dailyCount, recipientIds, lounge] = await Promise.all([
              countDailyAnnouncements(
                {
                  branchId: branch.id,
                  start: zonedDateTime(today, "00:00", branch.timezone),
                  end: zonedDateTime(
                    addDays(today, 1),
                    "00:00",
                    branch.timezone,
                  ),
                },
                tx,
              ),
              input.audience && range
                ? announcementRecipients(
                    {
                      branchId: branch.id,
                      floorId: input.audience.floorId,
                      spaceId: input.audience.spaceId,
                      operatorId: session.userId,
                      ...range,
                    },
                    tx,
                  )
                : Promise.resolve<string[]>([]),
              input.lounge
                ? loungeAvailability(
                    { branchId: branch.id, operatorId: session.userId },
                    tx,
                  )
                : Promise.resolve(null),
            ]);
            if (dailyCount >= 20)
              throw new ActionError("LIMIT_EXCEEDED", {
                message: "announce_daily",
              });
            if (recipientIds.length > 500)
              throw new ActionError("LIMIT_EXCEEDED", {
                message: "announce_recipients",
              });
            if (!input.lounge && !recipientIds.length)
              throw new ActionError("INVALID_INPUT");
            if (
              input.lounge &&
              (!lounge?.available || !lounge.spaceId || !lounge.roomId)
            )
              unavailable();
            if (
              !(await lockAnnouncementUsers(session.userId, recipientIds, tx))
            )
              throw new ActionError("STALE");
            requireAnnouncementPermission(
              await loadPermissionContext(session, branch.id, tx),
              branch.id,
            );
            const announcementId = crypto.randomUUID();
            let joined = false;
            let loungeMessageId: string | null = null;
            let chatEvents: RealtimeItem[] = [];
            if (input.lounge) {
              if (!lounge?.spaceId || !lounge.roomId) unavailable();
              try {
                joined = (
                  await joinExistingBranchLounge(
                    {
                      branchId: branch.id,
                      spaceId: lounge.spaceId,
                      userId: session.userId,
                      now,
                    },
                    tx,
                  )
                ).changed;
              } catch (error) {
                if (
                  error instanceof ActionError &&
                  (error.code === "NOT_FOUND" ||
                    error.details.message === "space_join_count")
                )
                  unavailable();
                throw error;
              }
              if (
                !(await lockAnnouncementRoom(lounge.roomId, lounge.spaceId, tx))
              )
                unavailable();
              const sent = await sendLockedMessage(
                {
                  roomId: lounge.roomId,
                  clientId: announcementId,
                  body: `${input.title}\n\n${input.body}\n\n<@everyone>`,
                  attachmentIds: [],
                },
                session,
                now,
                tx,
              );
              loungeMessageId = sent.message.id;
              chatEvents = sent.events;
            }
            await insertNotifications(
              buildBranchAnnouncementNotifications({
                branchName: branch.name,
                title: input.title,
                body: input.body,
                announcementId,
                actorId: session.userId,
                userIds: recipientIds,
                now,
              }),
              tx,
            );
            await insertAnnouncement(
              {
                id: announcementId,
                branchId: branch.id,
                authorId: session.userId,
                title: input.title,
                body: input.body,
                loungeMessageId,
                audience: input.audience,
                recipientCount: recipientIds.length,
                now,
              },
              tx,
            );
            return {
              announcementId,
              recipientCount: recipientIds.length,
              joined,
              chatEvents,
              recipientIds,
            };
          }, dependencies.database);
          await Promise.all([
            publish(result.chatEvents),
            publish(result.joined ? [reauthorize(session.userId)] : []),
            publish(
              result.recipientIds.map((id) => ({
                channel: userChannel(id),
                event: { type: "notifications.changed" as const },
              })),
            ),
          ]);
          return {
            announcementId: result.announcementId,
            recipientCount: result.recipientCount,
          };
        },
      },
      { ...dependencies, logError: log },
    ),
  };
}
