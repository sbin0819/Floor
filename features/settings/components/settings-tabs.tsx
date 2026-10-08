"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "cn";

const tabs = [
  ["/settings", "프로필"],
  ["/settings/account", "계정과 보안"],
  ["/settings/preferences", "알림과 기본값"],
] as const;
export function SettingsTabLinks({ pathname }: { pathname?: string }) {
  return (
    <nav
      aria-label="설정"
      className="flex gap-6 overflow-x-auto border-b border-border"
    >
      {tabs.map(([href, label]) => (
        <Link
          key={href}
          href={href}
          aria-current={pathname === href ? "page" : undefined}
          className={cn(
            "flex min-h-11 shrink-0 items-center border-b-2 px-1 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-ring",
            pathname === href
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground",
          )}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
export function SettingsTabs() {
  return <SettingsTabLinks pathname={usePathname()} />;
}
