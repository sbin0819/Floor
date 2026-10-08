import { requireSession } from "@/lib/auth/session";
import { toAvatar } from "@/lib/avatar";
import {
  readHomeDirectChats,
  readHomeMentionChats,
  readHomeMentionNames,
  readHomeMessageAttachments,
} from "@/lib/dal/home-recent-chats";
import { excerptOf } from "@/features/chat/message-text";
import { groupDisplayName } from "@/features/chat/group-name";
import { meetingName } from "@/features/chat/meeting-format";
import { systemMessageText } from "@/features/chat/system-messages";
import type { HomeQueryDependencies } from "./query-factory";
import type { HomeRecentChat } from "./types";

export function createHomeRecentQueries(
  dependencies: HomeQueryDependencies = {},
) {
  return {
    async getHomeRecentChats(): Promise<HomeRecentChat[]> {
      const session = await (dependencies.requireSession ?? requireSession)();
      const now = dependencies.now?.() ?? new Date();
      const [direct, mentions] = await Promise.all([
        readHomeDirectChats(session.userId, dependencies.database),
        readHomeMentionChats(session.userId, now, dependencies.database),
      ]);
      const candidates = [
        ...direct.map((row) => ({
          roomId: row.roomId,
          kind: row.kind,
          href: `/dm/${row.roomId}`,
          title:
            row.kind === "dm"
              ? row.peer!.name
              : groupDisplayName(
                  row.name,
                  row.memberNames,
                  row.memberCount - 1,
                ),
          subtitle: row.kind === "dm" ? "DM" : `그룹 · ${row.memberCount}명`,
          avatar:
            row.kind === "dm"
              ? { person: { ...toAvatar(row.peer!), name: row.peer!.name } }
              : { group: true as const },
          at: row.at!.toISOString(),
          unreadCount: row.unreadCount,
          mention: false,
          message: row.message,
        })),
        ...mentions.map((row) => ({
          roomId: row.roomId,
          kind: "mention" as const,
          href: row.bookingId
            ? `/m/${row.bookingId}`
            : `/s/${row.spaceId}/${row.roomId}?message=${row.message.id}`,
          title: row.message.authorName!,
          subtitle: row.bookingId
            ? meetingName({
                title: row.bookingTitle,
                spaceName: row.bookingSpaceName!,
              })
            : `# ${row.name} · ${row.spaceName}`,
          avatar: {
            person: {
              ...toAvatar(row.message.authorAvatar!),
              name: row.message.authorName!,
            },
          },
          at: new Date(row.message.createdAt).toISOString(),
          unreadCount: row.unreadCount,
          mention: true,
          message: row.message,
        })),
      ].sort(
        (a, b) => b.at.localeCompare(a.at) || a.roomId.localeCompare(b.roomId),
      );
      const selected = candidates
        .filter(
          (row, index) =>
            candidates.findIndex(
              (candidate) => candidate.roomId === row.roomId,
            ) === index,
        )
        .slice(0, 3);
      const ids = selected.flatMap(({ message }) =>
        message && !message.deleted ? [message.id] : [],
      );
      const [names, attachments] = await Promise.all([
        readHomeMentionNames(ids, dependencies.database),
        readHomeMessageAttachments(ids, dependencies.database),
      ]);
      return selected.map(({ message, ...row }) => {
        let excerpt = "메시지";
        if (message) {
          if (message.deleted) excerpt = "삭제된 메시지예요";
          else if (message.kind === "system" && message.systemData)
            excerpt = systemMessageText(message.systemData);
          else {
            const mentionedNames = new Map(
              names
                .filter((item) => item.messageId === message.id)
                .map((item) => [item.userId, item.name]),
            );
            excerpt = excerptOf(
              message.body,
              mentionedNames,
              attachments.filter((item) => item.messageId === message.id),
            );
            if (row.kind === "group_dm" && message.authorName)
              excerpt = `${message.authorName}: ${excerpt}`;
          }
        }
        return { ...row, excerpt };
      });
    },
  };
}
