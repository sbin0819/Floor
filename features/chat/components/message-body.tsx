import { Fragment, type ReactNode } from "react";
import {
  mentionLabel,
  parseMessageBody,
  type MessageBodyPart,
  type MentionNames,
} from "../message-text";

function renderParts(
  parts: MessageBodyPart[],
  names: MentionNames,
): ReactNode[] {
  return parts.map((part, index) => {
    switch (part.type) {
      case "text":
        return <Fragment key={index}>{part.text}</Fragment>;
      case "code":
        return (
          <code
            key={index}
            className="rounded bg-muted px-1 font-mono text-[0.9em]"
          >
            {part.text}
          </code>
        );
      case "codeBlock":
        return (
          <pre
            key={index}
            className="my-2 overflow-x-auto rounded-md bg-muted p-3 text-xs"
          >
            <code>{part.text}</code>
          </pre>
        );
      case "mention":
        return (
          <span
            key={index}
            data-mention={part.userId}
            className="rounded bg-accent px-0.5 font-medium text-accent-foreground"
          >
            {mentionLabel(part.userId, names)}
          </span>
        );
      case "link":
        return (
          <a
            key={index}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-primary underline underline-offset-2"
          >
            {part.text}
          </a>
        );
      case "bold":
        return <strong key={index}>{renderParts(part.children, names)}</strong>;
      case "italic":
        return <em key={index}>{renderParts(part.children, names)}</em>;
    }
  });
}

export function MessageBody({
  body,
  names = {},
}: {
  body: string;
  names?: MentionNames;
}) {
  return (
    <div className="text-sm leading-6 wrap-anywhere whitespace-pre-wrap">
      {renderParts(parseMessageBody(body), names)}
    </div>
  );
}
