import type { ActionErrorCode } from "@/lib/actions/result";
import type { ChatMessage, ReactionEmoji } from "../types";
import { chatDate } from "@/lib/time/chat-format";

export type DisplayMessage = ChatMessage & {
  delivery?: "pending" | "failed";
  errorCode?: ActionErrorCode;
  errorMessage?: string;
  reactionIntents?: Partial<
    Record<ReactionEmoji, { token: string; on: boolean }>
  >;
};

export const roomMessagesKey = (roomId: string) =>
  ["chat", "room", roomId, "messages"] as const;

export function messageKey(message: ChatMessage, userId: string): string {
  return message.authorId === userId && message.clientId
    ? message.clientId
    : message.id;
}

export function mergeChatMessages(
  current: readonly DisplayMessage[],
  incoming: readonly ChatMessage[],
  userId: string,
): DisplayMessage[] {
  const rows = [...current];
  for (const message of incoming) {
    const index = rows.findIndex(
      (row) =>
        row.id === message.id ||
        (message.authorId === userId &&
          row.authorId === userId &&
          message.clientId !== null &&
          row.clientId === message.clientId),
    );
    if (index === -1) rows.push(message);
    else {
      const previous = rows[index]!;
      if (previous.deletedAt && !message.deletedAt) continue;
      const newerEdit =
        !message.deletedAt &&
        (previous.editedAt ?? "") > (message.editedAt ?? "");
      rows[index] = {
        ...message,
        ...(previous.replyTo?.deleted &&
        previous.replyTo.id === message.replyTo?.id
          ? { replyTo: previous.replyTo }
          : {}),
        ...(newerEdit
          ? {
              body: previous.body,
              mentions: previous.mentions,
              mentionsEveryone: previous.mentionsEveryone,
              editedAt: previous.editedAt,
            }
          : {}),
        ...(previous.reactionIntents && !message.deletedAt
          ? { reactionIntents: previous.reactionIntents }
          : {}),
      };
    }
  }
  return rows.sort((a, b) => {
    if (a.delivery && b.delivery) return 0;
    if (a.delivery) return 1;
    if (b.delivery) return -1;
    return a.seq - b.seq;
  });
}

export function isMessageContinuation(
  previous: ChatMessage | undefined,
  message: ChatMessage,
): boolean {
  return Boolean(
    previous &&
    message.kind === "text" &&
    previous.kind === "text" &&
    message.authorId === previous.authorId &&
    chatDate(message.createdAt) === chatDate(previous.createdAt) &&
    Date.parse(message.createdAt) - Date.parse(previous.createdAt) >= 0 &&
    Date.parse(message.createdAt) - Date.parse(previous.createdAt) <=
      5 * 60_000,
  );
}

export function messageSendError(message: DisplayMessage): string {
  if (
    message.errorCode === "LIMIT_EXCEEDED" &&
    message.errorMessage === "send_rate"
  )
    return "잠시 뒤에 다시 보내 주세요";
  if (message.errorCode === "NOT_FOUND") return "이 채널을 더 볼 수 없어요";
  if (message.errorCode === "UNAUTHENTICATED") return "로그인이 풀렸어요";
  return "보내지 못했어요";
}
