"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function MemberNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="회원 메뉴" className="flex flex-wrap gap-1">
      {[
        ["/", "홈"],
        ["/branches", "공간 예약"],
        ["/bookings", "내 예약"],
      ].map(([href, label]) => {
        const active =
          pathname === href ||
          (href === "/branches" && pathname.startsWith("/branches/"));
        return (
          <Link
            key={href}
            href={href!}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-lg px-3 text-sm focus-visible:outline-2 focus-visible:outline-ring ${active ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted"}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
