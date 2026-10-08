import "server-only";

import { and, eq, sql } from "drizzle-orm";
import { messages, users } from "@/lib/db/schema";
import type {
  ChatMention,
  ChatMessage,
  ChatReaction,
  ChatAttachment,
  AttachmentSummary,
} from "@/features/chat/types";
import { excerptOf } from "@/features/chat/message-text";
import { parseSystemMessageData } from "@/features/chat/system-messages";
import type { DalDatabase } from "./database";
import { avatarColumns } from "./avatar";
import { toAvatar } from "@/lib/avatar";

type ReplyRow = {
  id: string;
  authorName: string | null;
  body: string;
  deleted: boolean;
  names: Record<string, string>;
  attachmentSummary: AttachmentSummary | null;
};

// 목록·페이지·액션 결과가 같은 집계를 써야 민감 필드와 리액션의 기준이 어긋나지 않는다.
export function selectChatMessages(userId: string, database: DalDatabase) {
  return database
    .select({
      id: messages.id,
      seq: messages.seq,
      authorId: messages.authorId,
      authorName: users.name,
      author: avatarColumns(users),
      kind: messages.kind,
      systemData: messages.systemData,
      body: messages.body,
      createdAt: messages.createdAt,
      clientId: sql<
        string | null
      >`case when ${messages.authorId} = ${userId} then ${messages.clientId} else null end`,
      replyTo: sql<ReplyRow | null>`message_details.reply_to`,
      mentions: sql<ChatMention[]>`message_details.mentions`,
      mentionsEveryone: messages.mentionsEveryone,
      editedAt: messages.editedAt,
      deletedAt: messages.deletedAt,
      reactions: sql<ChatReaction[]>`message_details.reactions`,
      attachments: sql<ChatAttachment[]>`message_details.attachments`,
    })
    .from(messages)
    .leftJoin(users, eq(messages.authorId, users.id))
    .leftJoinLateral(
      sql`(select
      (select json_build_object(
        'id', original.id, 'authorName', original_author.name,
        'body', original.body, 'deleted', original.deleted_at is not null,
        'attachmentSummary', case when original.deleted_at is not null then null else
          (select json_build_object('images', count(*) filter (where attachment.kind = 'image'),
            'files', count(*) filter (where attachment.kind = 'file'),
            'firstName', (array_agg(attachment.name order by attachment.position))[1])
          from message_attachments attachment where attachment.message_id = original.id having count(*) > 0) end,
        'names', coalesce((select jsonb_object_agg(mentioned.id, mentioned.name)
          from message_mentions original_mention join users mentioned on mentioned.id = original_mention.user_id
          where original_mention.message_id = original.id), '{}'::jsonb)
          || case when original_author.id is null then '{}'::jsonb else jsonb_build_object(original_author.id, original_author.name) end
      ) from messages original left join users original_author on original_author.id = original.author_id
        where original.id = ${messages.replyToId}) as reply_to,
      coalesce((select json_agg(json_build_object('userId', mentioned.id, 'name', mentioned.name) order by mentioned.id)
        from message_mentions mention join users mentioned on mentioned.id = mention.user_id
        where mention.message_id = ${messages.id}), '[]'::json) as mentions,
      coalesce((select json_agg(json_build_object('emoji', reaction.emoji, 'count', reaction.count,
        'mine', reaction.mine, 'names', reaction.names) order by reaction.emoji)
        from (select r.emoji, count(*)::int as count, bool_or(r.user_id = ${userId}) as mine,
          (array_agg(u.name order by r.created_at, r.user_id))[1:10] as names
          from message_reactions r join users u on u.id = r.user_id
          where r.message_id = ${messages.id} group by r.emoji) reaction), '[]'::json) as reactions,
      case when ${messages.deletedAt} is not null then '[]'::json else
        coalesce((select json_agg(json_build_object('id', attachment.id, 'name', attachment.name,
          'size', attachment.size, 'kind', attachment.kind, 'width', attachment.width, 'height', attachment.height)
          order by attachment.position) from message_attachments attachment
          where attachment.message_id = ${messages.id}), '[]'::json) end as attachments
    ) as message_details`,
      sql`true`,
    )
    .$dynamic();
}

type MessageRow = Awaited<ReturnType<typeof selectChatMessages>>[number];
export function serializeChatMessage(row: MessageRow): ChatMessage {
  const { author, ...message } = row;
  return {
    ...message,
    authorAvatar: row.kind === "text" && author ? toAvatar(author) : null,
    systemData:
      row.kind === "system" ? parseSystemMessageData(row.systemData) : null,
    createdAt: row.createdAt.toISOString(),
    editedAt: row.editedAt?.toISOString() ?? null,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    replyTo: row.replyTo
      ? {
          id: row.replyTo.id,
          authorName: row.replyTo.authorName,
          excerpt: row.replyTo.deleted
            ? "삭제된 메시지예요"
            : excerptOf(
                row.replyTo.body,
                row.replyTo.names,
                row.replyTo.attachmentSummary,
              ),
          deleted: row.replyTo.deleted,
          attachmentSummary:
            row.deletedAt || row.replyTo.deleted
              ? null
              : row.replyTo.attachmentSummary,
        }
      : null,
  };
}

export async function getChatMessage(
  messageId: string,
  roomId: string,
  userId: string,
  database: DalDatabase,
) {
  const [row] = await selectChatMessages(userId, database).where(
    and(eq(messages.id, messageId), eq(messages.roomId, roomId)),
  );
  return row ? serializeChatMessage(row) : null;
}
