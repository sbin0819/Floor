"use client";

import Link from "next/link";
import { useCallback } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CalendarDays, House, LayoutGrid, Users } from "lucide-react";
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
      className={
        mobile ? "grid h-16 grid-cols-4" : "hidden items-center gap-1 md:flex"
      }
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
            className={`relative inline-flex min-h-11 items-center justify-center rounded-lg px-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${mobile ? "flex-col gap-1 text-xs" : "text-sm"} ${selected ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
          >
            <LinkPending />
            {mobile && <Icon aria-hidden="true" className="relative size-5" />}
            <span className="relative">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
