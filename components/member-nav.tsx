"use client";

import Link from "next/link";
import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDays, House, LayoutGrid, Users } from "lucide-react";
import { cn } from "cn";
import { LinkPending } from "@/components/link-pending";
import {
  shouldInterceptNavigation,
  useOptimisticNavigation,
  type NavigateAction,
} from "@/components/optimistic-navigation";
import {
  activeMemberNav,
  memberNavItems,
} from "@/components/member-navigation";

const icons = {
  home: House,
  spaces: LayoutGrid,
  bookings: CalendarDays,
  teams: Users,
};

export function MemberNav({
  mobile = false,
  navigateAction,
}: {
  mobile?: boolean;
  navigateAction?: NavigateAction;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const navigate = useCallback<NavigateAction>(
    (href) => router.push(href),
    [router],
  );
  const navigation = useOptimisticNavigation(
    activeMemberNav(pathname),
    navigateAction ?? navigate,
  );
  const active = navigation.value;
  return (
    <nav
      aria-label={mobile ? "하단 회원 메뉴" : "회원 메뉴"}
      className={mobile ? "grid h-16 grid-cols-4" : "flex flex-col gap-1"}
    >
      {memberNavItems.map(({ key, href, label }) => {
        const Icon = icons[key];
        const selected = active === key;
        return (
          <Link
            key={href}
            href={href}
            onClick={(event) => {
              if (!shouldInterceptNavigation(event)) return;
              event.preventDefault();
              navigation.change(key, href);
            }}
            aria-current={selected ? "page" : undefined}
            className={cn(
              "relative inline-flex min-h-11 items-center justify-center px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
              mobile
                ? "flex-col gap-1 rounded-lg text-xs"
                : "h-11 justify-start gap-2 rounded-lg text-sm",
              selected
                ? mobile
                  ? "font-semibold text-primary"
                  : "bg-sidebar-accent font-semibold text-sidebar-accent-foreground"
                : mobile
                  ? "text-muted-foreground hover:text-foreground"
                  : "text-muted-foreground hover:bg-sidebar-accent/60",
            )}
          >
            <LinkPending />
            <Icon aria-hidden="true" className="relative size-5" />
            <span className="relative">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
