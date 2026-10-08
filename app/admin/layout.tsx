import type { ReactNode } from "react";
import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { AdminNav } from "@/features/admin/components/admin-nav";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="admin-shell min-h-screen lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-6 bg-sidebar p-6 text-sidebar-foreground lg:sticky lg:top-0 lg:h-dvh lg:min-h-0 lg:self-start">
        <div className="flex shrink-0 items-center justify-between">
          <Link
            href="/admin"
            className="inline-flex min-h-11 items-center text-2xl font-semibold"
          >
            Floor
          </Link>
          <span className="text-xs">운영자</span>
        </div>
        <div className="min-h-0 lg:flex-1 lg:overflow-y-auto">
          <AdminNav />
        </div>
        <div className="shrink-0 pb-[env(safe-area-inset-bottom)]">
          <SignOutButton />
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
