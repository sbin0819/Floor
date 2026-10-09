import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export function PlanEditorFrame({
  heading,
  actions,
  toolbar,
  panel,
  children,
  backHref = "/admin",
}: {
  heading?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  panel?: ReactNode;
  children?: ReactNode;
  backHref?: string;
}) {
  return (
    <main className="flex h-dvh min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center lg:hidden">
        <h1 className="text-xl font-bold">평면도 편집</h1>
        <p>평면도 편집은 1024px 이상 화면에서 할 수 있어요</p>
        <Link
          href={backHref}
          className="inline-flex min-h-11 items-center underline"
        >
          운영자 화면으로
        </Link>
      </div>
      <div className="hidden min-h-0 flex-1 flex-col lg:flex">
        <header className="z-20 flex min-h-16 shrink-0 items-center gap-3 border-b bg-background px-3">
          <Link
            href={backHref}
            aria-label="평면도 목록으로"
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ArrowLeft className="size-5" />
          </Link>
          <h1 className="min-w-0 text-lg font-bold">
            평면도 편집{heading && <> · {heading}</>}
          </h1>
          <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
            {actions}
          </div>
        </header>
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="평면도 도구"
            className="z-10 flex w-[60px] shrink-0 flex-col items-center gap-2 border-r bg-background py-3"
          >
            {toolbar}
          </nav>
          <div className="relative min-h-0 min-w-0 flex-1">{children}</div>
          <aside
            aria-label="도형 속성"
            className="w-80 shrink-0 overflow-y-auto border-l bg-background"
          >
            {panel}
          </aside>
        </div>
      </div>
    </main>
  );
}
export function PlanEditorSkeleton() {
  return (
    <PlanEditorFrame
      heading={<Skeleton className="inline-block h-5 w-24" />}
      panel={
        <div className="space-y-5 p-5">
          <h2 className="font-semibold">도형 속성</h2>
          <Skeleton className="h-32" />
          <h2 className="font-semibold">검사 문제</h2>
          <Skeleton className="h-20" />
        </div>
      }
    >
      <div aria-busy="true" className="h-full bg-muted">
        <span role="status" className="sr-only">
          평면도를 불러오고 있어요
        </span>
      </div>
    </PlanEditorFrame>
  );
}
