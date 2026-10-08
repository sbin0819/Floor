import { LogOut, Pencil, UserPlus, Users } from "lucide-react";
import { formatChatTime } from "@/lib/time/chat-format";
import { parseSystemMessageData, systemMessageText } from "../system-messages";

export function SystemMessageContent({
  data,
  body,
  createdAt,
}: {
  data: unknown;
  body: string;
  createdAt: string;
}) {
  const parsed = parseSystemMessageData(data);
  const Icon =
    parsed?.type === "members_added"
      ? UserPlus
      : parsed?.type === "member_left"
        ? LogOut
        : parsed?.type === "room_renamed"
          ? Pencil
          : Users;
  return (
    <div
      data-system-message
      className="flex w-full items-center justify-center gap-2 py-2 text-center text-xs text-muted-foreground"
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      <span>{parsed ? systemMessageText(parsed) : body}</span>
      <time dateTime={createdAt} className="shrink-0 tabular-nums">
        {formatChatTime(createdAt)}
      </time>
    </div>
  );
}
