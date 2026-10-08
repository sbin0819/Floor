import {
  isMessageContinuation,
  type DisplayMessage,
} from "./components/message-state";

export function foldBlockedMessages(
  messages: readonly DisplayMessage[],
  blocked: readonly string[],
  expanded: ReadonlySet<string>,
) {
  const blockedIds = new Set(blocked);
  const rows: DisplayMessage[] = [];
  const groups = new Map<
    string,
    { ids: string[]; seqs: number[]; lastSeq: number }
  >();
  let current: {
    message: DisplayMessage;
    ids: string[];
    seqs: number[];
    lastSeq: number;
  } | null = null;
  for (const message of messages) {
    if (
      message.kind !== "text" ||
      !message.authorId ||
      !blockedIds.has(message.authorId)
    ) {
      current = null;
      rows.push(message);
      continue;
    }
    if (current && isMessageContinuation(current.message, message)) {
      current.message = message;
      current.ids.push(message.id);
      current.seqs.push(message.seq);
      current.lastSeq = message.seq;
      if (expanded.has(current.ids[0]!)) rows.push(message);
    } else {
      current = {
        message,
        ids: [message.id],
        seqs: [message.seq],
        lastSeq: message.seq,
      };
      groups.set(message.id, current);
      rows.push(message);
    }
  }
  for (const id of expanded) groups.delete(id);
  return { rows, groups };
}
