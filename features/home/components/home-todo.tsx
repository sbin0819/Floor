import Link from "next/link";
import {
  ChevronRight,
  Mail,
  MessageCircle,
  UserPlus,
  Users,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { HomeTodo as HomeTodoData } from "../types";

export function HomeTodo({ data }: { data: HomeTodoData }) {
  const top = data.joinRequests.top;
  const items = [
    {
      label: top ? `${top.teamName} 가입 요청` : "가입 요청",
      count: top?.count ?? 0,
      href: top ? `/teams/${top.teamId}?tab=requests` : "/teams",
      Icon: Users,
    },
    {
      label: "가입 요청",
      count: data.joinRequests.rest,
      href: "/teams",
      Icon: Users,
    },
    {
      label: "받은 팀 초대",
      count: data.teamInvites,
      href: "/teams",
      Icon: Mail,
    },
    {
      label: "받은 친구 요청",
      count: data.friendRequests,
      href: "/friends?tab=received",
      Icon: UserPlus,
    },
    {
      label: "메시지 요청",
      count: data.messageRequests,
      href: "/friends?tab=requests",
      Icon: MessageCircle,
    },
    {
      label: "스페이스 초대",
      count: data.spaceInvites.count,
      href: data.spaceInvites.href,
      Icon: Mail,
    },
  ].filter((item) => item.count > 0 && item.href);
  if (!items.length) return null;
  return (
    <section
      aria-label="확인할 것"
      className="flex flex-col gap-2 rounded-xl border border-border bg-card px-5 py-3 shadow-card lg:flex-row lg:items-center lg:gap-5"
    >
      <h2 className="shrink-0 text-sm font-semibold">확인할 것</h2>
      <ul className="flex min-w-0 flex-1 flex-col gap-x-5 lg:flex-row lg:flex-wrap">
        {items.map(({ label, count, href, Icon }) => (
          <li key={label} className="min-w-0">
            <Link
              href={href!}
              aria-label={`${label} ${count}개`}
              className="flex min-h-11 items-center gap-2 rounded-lg text-sm hover:underline focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Icon
                aria-hidden="true"
                className="size-4 shrink-0 text-muted-foreground"
              />
              <span className="min-w-0 truncate">{label}</span>
              <Badge variant="destructive" className="tabular-nums">
                {count}
                <span className="sr-only">개</span>
              </Badge>
              <ChevronRight
                aria-hidden="true"
                className="ml-auto size-4 shrink-0 text-muted-foreground"
              />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
