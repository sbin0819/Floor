import {
  mentionLabel,
  messageMentionTokens,
  type MentionNames,
} from "./message-text";

export function messageCopyText(
  body: string,
  names: MentionNames = {},
): string {
  const parts: string[] = [];
  let cursor = 0;
  for (const token of messageMentionTokens(body)) {
    parts.push(
      body.slice(cursor, token.start),
      mentionLabel(token.userId, names),
    );
    cursor = token.end;
  }
  parts.push(body.slice(cursor));
  return parts.join("");
}
