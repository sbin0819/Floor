import Link from "next/link";
import type { ReactNode } from "react";
import { AdminSignOutButton } from "./admin-sign-out-button";
import { Skeleton } from "@/components/ui/skeleton";
import { SkeletonRegion } from "@/components/skeleton-region";

export function AdminBrand() {
  return (
    <div className="flex shrink-0 items-center justify-between gap-3">
      <Link
        href="/admin"
        className="inline-flex min-h-11 items-center rounded-sm text-2xl font-semibold focus-visible:outline-2 focus-visible:outline-ring"
      >
        Floor
      </Link>
      <span className="rounded-md border border-sidebar-border px-2 py-1 text-xs">
        운영자
      </span>
    </div>
  );
}

export function AdminShellFooter({
  name,
  onNavigate,
}: {
  name?: string;
  onNavigate?: () => void;
}) {
  return (
    <div className="mt-auto shrink-0 space-y-3 border-t border-sidebar-border pt-4 pb-[env(safe-area-inset-bottom)]">
      <Link
        href="/"
        onClick={onNavigate}
        className="flex min-h-11 items-center rounded-lg px-3 text-sm hover:bg-sidebar-accent focus-visible:outline-2 focus-visible:outline-ring"
      >
        멤버 화면으로
      </Link>
      {name !== undefined && <p className="truncate px-3 text-sm">{name}</p>}
      <AdminSignOutButton />
    </div>
  );
}

export function AdminSidebarPending() {
  return (
    <>
      <SkeletonRegion className="space-y-3">
        <Skeleton className="h-11 w-full bg-sidebar-accent" />
        <Skeleton className="h-11 w-full bg-sidebar-accent" />
        <Skeleton className="h-11 w-full bg-sidebar-accent" />
      </SkeletonRegion>
      <AdminShellFooter />
    </>
  );
}

export function AdminMobilePending() {
  return (
    <div className="flex h-16 items-center justify-between gap-4 px-4">
      <span className="font-semibold">운영자</span>
      <Skeleton className="h-6 w-20" />
    </div>
  );
}

export function AdminShellFrame({
  sidebar,
  mobile,
  children,
}: {
  sidebar: ReactNode;
  mobile: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="admin-shell min-h-screen [--admin-mobile-header-height:4rem] lg:grid lg:grid-cols-[240px_minmax(0,1fr)] lg:[--admin-mobile-header-height:0px]">
      <aside
        aria-label="운영자 사이드바"
        className="hidden flex-col gap-6 bg-sidebar p-5 text-sidebar-foreground lg:sticky lg:top-0 lg:flex lg:h-dvh lg:min-h-0 lg:self-start"
      >
        <AdminBrand />
        {sidebar}
      </aside>
      <div className="min-w-0">
        <header className="sticky top-0 z-45 h-16 border-b border-border bg-background lg:hidden">
          {mobile}
        </header>
        {children}
      </div>
    </div>
  );
}
