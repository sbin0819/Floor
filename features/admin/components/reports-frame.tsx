import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";

export function ReportsFrame({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
      <header className="sticky top-[var(--admin-mobile-header-height,0px)] z-30 bg-background py-2">
        <h1 className="text-2xl font-bold">신고</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          지점 라운지와 회의 채널의 신고를 확인해요
        </p>
      </header>
      {children}
    </main>
  );
}
export function ReportCardsSkeleton() {
  return (
    <div aria-busy="true" className="space-y-4">
      <span role="status" className="sr-only">
        신고를 불러오고 있어요
      </span>
      {[0, 1].map((key) => (
        <section
          key={key}
          className="space-y-5 rounded-xl border bg-card p-5 shadow-card"
        >
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-56" />
          <Skeleton className="h-20 w-full" />
          <div className="flex justify-end gap-2">
            <Skeleton className="h-11 w-24" />
            <Skeleton className="h-11 w-32" />
          </div>
        </section>
      ))}
    </div>
  );
}
export function ReportsSkeleton() {
  return (
    <div className="space-y-5">
      <div className="flex min-h-11 items-center gap-5 text-sm">
        <span>처리할 것</span>
        <span>처리함</span>
      </div>
      <p className="text-sm text-muted-foreground">
        DM·그룹·팀·커뮤니티 신고와 사용자 신고는 기록만 남아요.
      </p>
      <ReportCardsSkeleton />
    </div>
  );
}
