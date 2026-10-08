import type { ReactNode } from "react";
import { ArrowLeft } from "lucide-react";
import { PageContainer, PageHeading } from "@/components/page-container";
import { Skeleton } from "@/components/ui/skeleton";

export function BookingEditLayout({ children }: { children: ReactNode }) {
  return (
    <PageContainer width="branches" className="space-y-6">
      <a
        href="/bookings"
        className="inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />내 예약으로
      </a>
      <PageHeading
        title="예약 바꾸기"
        description="시간, 인원, 참석자와 제목을 바꿀 수 있어요. 공간과 날짜는 그대로예요."
      />
      {children}
    </PageContainer>
  );
}

export function BookingEditSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="예약을 불러오고 있어요"
      className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]"
    >
      <div className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-card">
        <Skeleton className="aspect-[16/9] w-full" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-24 w-full" />
      </div>
      <div className="space-y-5 rounded-xl border border-border bg-card p-5 shadow-card">
        <h2 className="font-bold">하루 일정</h2>
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
      </div>
    </div>
  );
}
