export const MAX_MESSAGE_MENTIONS = 20;
import type { AttachmentSummary } from "./types";

export type MessageBodyPart =
  | { type: "text" | "code" | "codeBlock"; text: string }
  | { type: "mention"; userId: string | "everyone" }
  | { type: "link"; text: string; href: string }
  | { type: "bold" | "italic"; children: MessageBodyPart[] };

export type MentionNames =
  ReadonlyMap<string, string> | Readonly<Record<string, string>>;

type Span = { start: number; end: number; part: MessageBodyPart };
type Marker = { start: number; end: number; marker: "*" | "**" };
type Piece = Span | Marker;
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/iu;

function plain(body: string, start: number, end: number): Span {
  return { start, end, part: { type: "text", text: body.slice(start, end) } };
}

function codeBlocks(body: string): Span[] {
  const result: Span[] = [];
  let textStart = 0;
  let index = 0;
  while (index < body.length) {
    if (
      (index === 0 || body[index - 1] === "\n") &&
      body.startsWith("```", index)
    ) {
      const lineEnd = body.indexOf("\n", index + 3);
      const end = lineEnd < 0 ? -1 : body.indexOf("```", lineEnd + 1);
      if (end < 0) break;
      if (textStart < index) result.push(plain(body, textStart, index));
      result.push({
        start: index,
        end: end + 3,
        part: { type: "codeBlock", text: body.slice(lineEnd + 1, end) },
      });
      index = end + 3;
      textStart = index;
    } else index++;
  }
  if (textStart < body.length) result.push(plain(body, textStart, body.length));
  return result;
}

function inlineCode(body: string, span: Span): Span[] {
  if (span.part.type !== "text") return [span];
  const result: Span[] = [];
  let textStart = span.start;
  let index = span.start;
  while (index < span.end) {
    if (body[index] !== "`") {
      index++;
      continue;
    }
    let runEnd = index + 1;
    while (runEnd < span.end && body[runEnd] === "`") runEnd++;
    if (runEnd - index !== 1) {
      index = runEnd;
      continue;
    }
    const end = body.indexOf("`", index + 1);
    if (end < 0 || end >= span.end) break;
    if (textStart < index) result.push(plain(body, textStart, index));
    result.push({
      start: index,
      end: end + 1,
      part: { type: "code", text: body.slice(index + 1, end) },
    });
    index = end + 1;
    textStart = index;
  }
  if (textStart < span.end) result.push(plain(body, textStart, span.end));
  return result;
}

function readMention(body: string, index: number): Span | null {
  if (body.startsWith("<@everyone>", index))
    return {
      start: index,
      end: index + 11,
      part: { type: "mention", userId: "everyone" },
    };
  if (!body.startsWith("<@", index) || body[index + 38] !== ">") return null;
  const userId = body.slice(index + 2, index + 38);
  return uuid.test(userId)
    ? {
        start: index,
        end: index + 39,
        part: { type: "mention", userId: userId.toLowerCase() },
      }
    : null;
}

function mentions(body: string, span: Span): Span[] {
  if (span.part.type !== "text") return [span];
  const result: Span[] = [];
  let textStart = span.start;
  let index = span.start;
  while (index < span.end) {
    const mention = body[index] === "<" ? readMention(body, index) : null;
    if (mention && mention.end <= span.end) {
      if (textStart < index) result.push(plain(body, textStart, index));
      result.push(mention);
      index = mention.end;
      textStart = index;
    } else index++;
  }
  if (textStart < span.end) result.push(plain(body, textStart, span.end));
  return result;
}

function mentionSpans(body: string) {
  return codeBlocks(body)
    .flatMap((span) => inlineCode(body, span))
    .flatMap((span) => mentions(body, span));
}

export function messageMentionTokens(body: string) {
  return mentionSpans(body).flatMap(({ start, end, part }) =>
    part.type === "mention" ? [{ start, end, userId: part.userId }] : [],
  );
}

function readLink(
  body: string,
  index: number,
  bound: number,
): { scannedTo: number; span: Span | null } | null {
  const prefix = body.slice(index, index + 8).toLowerCase();
  if (!prefix.startsWith("https://") && !prefix.startsWith("http://"))
    return null;
  let end = index;
  let unmatchedClosing = 0;
  const openings: number[] = [];
  while (end < bound) {
    const code = body.charCodeAt(end);
    if (code <= 32 || code >= 127 || '"<>`'.includes(body[end]!)) break;
    if (body[end] === "(") openings.push(end);
    if (body[end] === ")") {
      if (openings.length) openings.pop();
      else unmatchedClosing++;
    }
    end++;
  }
  const scannedTo = end;
  if (openings.length) end = openings[0]!;
  while (end > index) {
    const last = body[end - 1]!;
    if (".,!?".includes(last)) end--;
    else if (last === ")" && unmatchedClosing > 0) {
      end--;
      unmatchedClosing--;
    } else break;
  }
  const text = body.slice(index, end);
  try {
    const url = new URL(text);
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname)
      return { scannedTo, span: null };
    return {
      scannedTo,
      span: { start: index, end, part: { type: "link", text, href: url.href } },
    };
  } catch {
    return { scannedTo, span: null };
  }
}

function links(body: string, span: Span): Span[] {
  if (span.part.type !== "text") return [span];
  const result: Span[] = [];
  let textStart = span.start;
  let index = span.start;
  while (index < span.end) {
    const link =
      body[index] === "h" || body[index] === "H"
        ? readLink(body, index, span.end)
        : null;
    if (link?.span) {
      if (textStart < index) result.push(plain(body, textStart, index));
      result.push(link.span);
      if (link.span.end < link.scannedTo)
        result.push(plain(body, link.span.end, link.scannedTo));
      index = link.scannedTo;
      textStart = index;
    } else index = link ? link.scannedTo : index + 1;
  }
  if (textStart < span.end) result.push(plain(body, textStart, span.end));
  return result;
}

function emphasisPieces(body: string, span: Span): Piece[] {
  if (span.part.type !== "text") return [span];
  const result: Piece[] = [];
  let textStart = span.start;
  let index = span.start;
  while (index < span.end) {
    if (body[index] !== "*" && body[index] !== "\n") {
      index++;
      continue;
    }
    let end = index + 1;
    if (body[index] === "*") while (end < span.end && body[end] === "*") end++;
    if (textStart < index) result.push(plain(body, textStart, index));
    const size = end - index;
    result.push(
      body[index] === "*" && size <= 2
        ? { start: index, end, marker: size === 2 ? "**" : "*" }
        : plain(body, index, end),
    );
    index = end;
    textStart = index;
  }
  if (textStart < span.end) result.push(plain(body, textStart, span.end));
  return result;
}

function emphasis(body: string, spans: Span[]): MessageBodyPart[] {
  const pieces = spans.flatMap((span) => emphasisPieces(body, span));
  const pairs = new Map<number, number>();
  const pending: number[] = [];
  for (const [index, piece] of pieces.entries()) {
    if (!("marker" in piece)) {
      if (body.slice(piece.start, piece.end).includes("\n")) pending.length = 0;
      continue;
    }
    const before = body[piece.start - 1] ?? "";
    const after = body[piece.end] ?? "";
    const opens =
      !!after && !/\s/u.test(after) && !/[\p{L}\p{N}]/u.test(before);
    const closes =
      !!before && !/\s/u.test(before) && !/[\p{L}\p{N}]/u.test(after);
    const last = pending.at(-1);
    const opening = last === undefined ? undefined : pieces[last];
    if (
      closes &&
      opening &&
      "marker" in opening &&
      opening.marker === piece.marker
    ) {
      pending.pop();
      pairs.set(last!, index);
      pairs.set(index, last!);
    } else if (opens) pending.push(index);
  }
  const result: MessageBodyPart[] = [];
  const stack = [result];
  for (const [index, piece] of pieces.entries()) {
    const target = stack.at(-1)!;
    if (!("marker" in piece)) target.push(piece.part);
    else {
      const pair = pairs.get(index);
      if (pair === undefined) target.push({ type: "text", text: piece.marker });
      else if (pair > index) {
        const children: MessageBodyPart[] = [];
        target.push({
          type: piece.marker === "**" ? "bold" : "italic",
          children,
        });
        stack.push(children);
      } else stack.pop();
    }
  }
  return result;
}

/** 앞 단계가 만든 조각은 다시 해석하지 않고 각 단계를 정방향으로 한 번씩만 훑는다. */
export function parseMessageBody(body: string): MessageBodyPart[] {
  return emphasis(
    body,
    mentionSpans(body).flatMap((span) => links(body, span)),
  );
}

export function extractMentions(body: string): {
  userIds: string[];
  everyone: boolean;
  exceedsLimit: boolean;
} {
  const ids = new Set<string>();
  let everyone = false;
  for (const { part } of mentionSpans(body)) {
    if (part.type !== "mention") continue;
    if (part.userId === "everyone") everyone = true;
    else ids.add(part.userId);
  }
  return {
    userIds: [...ids],
    everyone,
    exceedsLimit: ids.size > MAX_MESSAGE_MENTIONS,
  };
}

export function mentionLabel(userId: string, names: MentionNames = {}): string {
  if (userId === "everyone") return "@모두";
  const name =
    "get" in names && typeof names.get === "function"
      ? names.get(userId)
      : Object.hasOwn(names, userId)
        ? (names as Readonly<Record<string, string>>)[userId]
        : undefined;
  return `@${name ?? "알 수 없는 사용자"}`;
}

export function summarizeAttachments(
  attachments: readonly { kind: "image" | "file"; name: string }[],
): AttachmentSummary | null {
  if (!attachments.length) return null;
  return {
    images: attachments.filter((item) => item.kind === "image").length,
    files: attachments.filter((item) => item.kind === "file").length,
    firstName: attachments[0]!.name,
  };
}

export function excerptOf(
  body: string,
  names: MentionNames = {},
  attachments?:
    | readonly { kind: "image" | "file"; name: string }[]
    | AttachmentSummary
    | null,
): string {
  const singleLine = (value: string) =>
    Array.from(value.replace(/\r\n|[\r\n]/gu, " "))
      .slice(0, 80)
      .join("");
  if (!body.trim() && attachments) {
    const summary =
      "images" in attachments
        ? attachments
        : {
            images: attachments.filter((item) => item.kind === "image").length,
            files: attachments.filter((item) => item.kind === "file").length,
            firstName: attachments[0]?.name ?? "",
          };
    const total = summary.images + summary.files;
    if (total)
      return singleLine(
        summary.files === 0
          ? total === 1
            ? "사진"
            : `사진 ${total}장`
          : total === 1
            ? `파일: ${summary.firstName}`
            : `파일 ${total}개`,
      );
  }
  const text = mentionSpans(body)
    .map(({ start, end, part }) =>
      part.type === "mention"
        ? mentionLabel(part.userId, names)
        : body.slice(start, end),
    )
    .join("");
  return singleLine(text);
}
