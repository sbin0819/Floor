import {
  CalendarDays,
  CalendarX,
  Clock,
  LogOut,
  Pencil,
  Phone,
  PhoneOff,
  UserMinus,
  UserPlus,
  Users,
} from "lucide-react";
import { formatChatTime } from "@/lib/time/chat-format";
import {
  parseSystemMessageData,
  systemMessageText,
  type SystemMessageData,
} from "../system-messages";

const systemIcons: Record<SystemMessageData["type"], typeof Users> = {
  group_created: Users,
  members_added: UserPlus,
  member_left: LogOut,
  room_renamed: Pencil,
  booking_created: CalendarDays,
  booking_time_changed: Clock,
  booking_cancelled: CalendarX,
  participants_added: UserPlus,
  participant_removed: UserMinus,
  participant_left: LogOut,
  huddle_started: Phone,
  huddle_ended: PhoneOff,
};

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
  const Icon = parsed ? systemIcons[parsed.type] : Users;
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
