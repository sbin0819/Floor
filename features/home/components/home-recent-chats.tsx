import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { Badge } from "@/components/ui/badge";
import {
  HomeCard,
  HomeCardLink,
} from "@/features/bookings/components/home-frame";
import type { HomeRecentChat } from "../types";

export function HomeRecentChats({ data }: { data: HomeRecentChat[] }) {
  if (!data.length) return null;
  return (
    <HomeCard
      title="최근 대화"
      action={
        <HomeCardLink href="/messages">
          메시지 <ArrowRight aria-hidden="true" className="size-4" />
        </HomeCardLink>
      }
    >
      <ul className="-mx-2 divide-y divide-border">
        {data.map((chat) => (
          <li key={chat.roomId}>
            <Link
              href={chat.href}
              className="flex min-h-11 items-start gap-3 rounded-lg px-2 py-4 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
            >
              {"person" in chat.avatar ? (
                <UserAvatar
                  name={chat.avatar.person.name}
                  avatar={chat.avatar.person}
                  size={36}
                />
              ) : (
                <span
                  aria-hidden="true"
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                >
                  <Users className="size-5" />
                </span>
              )}
              <span className="min-w-0 flex-1 space-y-1">
                <span className="flex items-center gap-2">
                  <span className="truncate font-medium">{chat.title}</span>
                  {(chat.unreadCount > 0 || chat.mention) && (
                    <Badge
                      variant="destructive"
                      className="ml-auto tabular-nums"
                      aria-label={
                        chat.unreadCount > 0
                          ? `읽지 않은 메시지 ${chat.unreadCount}개`
                          : "읽지 않은 멘션"
                      }
                    >
                      {chat.unreadCount > 0 ? chat.unreadCount : "@"}
                    </Badge>
                  )}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {chat.subtitle}
                </span>
                <span className="block truncate text-sm text-muted-foreground">
                  {chat.excerpt}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </HomeCard>
  );
}
