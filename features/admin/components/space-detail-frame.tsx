import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
export function SpaceDetailFrame({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
      <header className="sticky top-[var(--admin-mobile-header-height,0px)] z-30 bg-background py-2">
        <h1 className="text-2xl font-bold">공간 관리</h1>
      </header>
      {children}
    </main>
  );
}
export function SpaceDetailSkeleton() {
  return (
    <div aria-busy="true" className="space-y-6">
      <span role="status" className="sr-only">
        공간을 불러오고 있어요
      </span>
      <Skeleton className="h-6 w-60" />
      <div className="flex min-h-11 gap-6 text-sm">
        <span>정보</span>
        <span>이용 대상</span>
        <span>사진</span>
      </div>
      <Skeleton className="h-80 w-full rounded-xl" />
    </div>
  );
}
