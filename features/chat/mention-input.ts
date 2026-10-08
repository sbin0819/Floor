import { messageMentionTokens, type MentionNames } from "./message-text";

export type MentionSelection = {
  start: number;
  end: number;
  userId: string;
  label: string;
};
export type MentionInputValue = { text: string; mentions: MentionSelection[] };
export type MentionCandidate = { userId: string; name: string };
export type MentionQuery = { start: number; end: number; query: string };

export function fromMessageBody(
  body: string,
  names: MentionNames = {},
  allowEveryone = false,
): MentionInputValue {
  let text = "";
  let cursor = 0;
  const mentions: MentionSelection[] = [];
  for (const token of messageMentionTokens(body)) {
    const name =
      token.userId === "everyone"
        ? allowEveryone
          ? "모두"
          : undefined
        : names instanceof Map
          ? names.get(token.userId)
          : (names as Readonly<Record<string, string>>)[token.userId];
    if (!name) continue;
    text += body.slice(cursor, token.start);
    const label = `@${name}`;
    mentions.push({
      start: text.length,
      end: text.length + label.length,
      userId: token.userId,
      label,
    });
    text += label;
    cursor = token.end;
  }
  return { text: text + body.slice(cursor), mentions };
}

export function toMessageBody(value: MentionInputValue): string {
  let body = "";
  let cursor = 0;
  for (const mention of [...value.mentions].sort((a, b) => a.start - b.start)) {
    if (
      mention.start < cursor ||
      mention.end <= mention.start ||
      value.text.slice(mention.start, mention.end) !== mention.label ||
      !/^(?:everyone|[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12})$/iu.test(
        mention.userId,
      )
    )
      continue;
    body += value.text.slice(cursor, mention.start) + `<@${mention.userId}>`;
    cursor = mention.end;
  }
  return body + value.text.slice(cursor);
}

export function updateMentionInput(
  value: MentionInputValue,
  text: string,
): MentionInputValue {
  if (text === value.text) return value;
  let start = 0;
  while (
    start < text.length &&
    start < value.text.length &&
    text[start] === value.text[start]
  )
    start++;
  let oldEnd = value.text.length;
  let newEnd = text.length;
  while (
    oldEnd > start &&
    newEnd > start &&
    value.text[oldEnd - 1] === text[newEnd - 1]
  ) {
    oldEnd--;
    newEnd--;
  }
  const delta = newEnd - oldEnd;
  const mentions = value.mentions.flatMap((mention) => {
    if (
      start === oldEnd &&
      start === mention.end &&
      /^[\p{L}\p{N}_]/u.test(text.slice(start, newEnd))
    )
      return [];
    const next =
      mention.end <= start
        ? mention
        : mention.start >= oldEnd
          ? {
              ...mention,
              start: mention.start + delta,
              end: mention.end + delta,
            }
          : null;
    return next && text.slice(next.start, next.end) === next.label
      ? [next]
      : [];
  });
  return { text, mentions };
}

export function findMentionQuery(
  value: MentionInputValue,
  caret: number,
): MentionQuery | null {
  if (
    caret < 0 ||
    caret > value.text.length ||
    value.mentions.some(({ start, end }) => caret > start && caret <= end)
  )
    return null;
  const start = value.text.lastIndexOf("@", caret - 1);
  if (
    start < 0 ||
    (start > 0 && !/[\s([{"'.,!?]/u.test(value.text[start - 1]!))
  )
    return null;
  const query = value.text.slice(start + 1, caret);
  if (/\s|@|[<>`]/u.test(query)) return null;
  return { start, end: caret, query };
}

export function chooseMention(
  value: MentionInputValue,
  query: MentionQuery,
  candidate: MentionCandidate,
) {
  if (value.text.slice(query.start, query.end) !== `@${query.query}`)
    return { value, caret: query.end };
  const label = `@${candidate.name}`;
  const suffix = value.text.slice(query.end);
  const separator = /^\s/u.test(suffix) ? "" : " ";
  const next = updateMentionInput(
    value,
    value.text.slice(0, query.start) + label + separator + suffix,
  );
  next.mentions.push({
    start: query.start,
    end: query.start + label.length,
    label,
    userId: candidate.userId,
  });
  next.mentions.sort((a, b) => a.start - b.start);
  return { value: next, caret: query.start + label.length + separator.length };
}

export function filterMentionCandidates(
  members: readonly MentionCandidate[],
  query: string,
  allowEveryone = false,
): MentionCandidate[] {
  const normalized = query.normalize("NFC").toLocaleLowerCase("ko");
  const seen = new Set<string>();
  const result = members
    .filter(({ userId, name }) => {
      if (
        seen.has(userId) ||
        !name.normalize("NFC").toLocaleLowerCase("ko").includes(normalized)
      )
        return false;
      seen.add(userId);
      return true;
    })
    .slice(0, 8);
  if (
    allowEveryone &&
    (!normalized ||
      "모두".includes(normalized) ||
      "everyone".includes(normalized))
  )
    result.push({ userId: "everyone", name: "모두" });
  return result;
}
