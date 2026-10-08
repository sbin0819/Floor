import { Fragment, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  mentionLabel,
  parseMessageBody,
  type MessageBodyPart,
  type MentionNames,
} from "../message-text";

function renderParts(
  parts: MessageBodyPart[],
  names: MentionNames,
  tone: "mine" | "other",
): ReactNode[] {
  return parts.map((part, index) => {
    switch (part.type) {
      case "text":
        return <Fragment key={index}>{part.text}</Fragment>;
      case "code":
        return (
          <code
            key={index}
            className={cn(
              "rounded px-1 font-mono text-[0.9em]",
              tone === "mine" ? "bg-chat-mine-foreground/20" : "bg-muted",
            )}
          >
            {part.text}
          </code>
        );
      case "codeBlock":
        return (
          <pre
            key={index}
            className={cn(
              "my-2 max-w-full overflow-x-auto rounded-md p-3 text-xs",
              tone === "mine" ? "bg-chat-mine-foreground/20" : "bg-muted",
            )}
          >
            <code>{part.text}</code>
          </pre>
        );
      case "mention":
        return (
          <span
            key={index}
            data-mention={part.userId}
            className={cn(
              "rounded px-0.5 font-medium",
              tone === "mine"
                ? "bg-chat-mine-foreground/20 text-current"
                : "bg-accent text-accent-foreground",
            )}
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
            className={cn(
              "underline underline-offset-2",
              tone === "mine" ? "text-current" : "text-primary",
            )}
          >
            {part.text}
          </a>
        );
      case "bold":
        return (
          <strong key={index}>{renderParts(part.children, names, tone)}</strong>
        );
      case "italic":
        return <em key={index}>{renderParts(part.children, names, tone)}</em>;
    }
  });
}

export function MessageBody({
  body,
  names = {},
  tone = "other",
}: {
  body: string;
  names?: MentionNames;
  tone?: "mine" | "other";
}) {
  return (
    <div className="text-sm leading-6 wrap-anywhere break-keep whitespace-pre-wrap">
      {renderParts(parseMessageBody(body), names, tone)}
    </div>
  );
}
