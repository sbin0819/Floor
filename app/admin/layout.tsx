import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { AdminNav } from "@/features/admin/components/admin-nav";
import { AdminNavSkeleton } from "@/features/admin/components/admin-skeletons";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="admin-shell min-h-screen lg:grid lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-6 bg-sidebar p-6 text-sidebar-foreground lg:min-h-screen">
        <div className="flex items-center justify-between">
          <Link href="/admin" className="text-2xl font-semibold">
            Floor
          </Link>
          <span className="text-xs">운영자</span>
        </div>
        <Suspense fallback={<AdminNavSkeleton />}>
          <AdminNav />
        </Suspense>
        <div className="lg:mt-auto">
          <SignOutButton />
        </div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
