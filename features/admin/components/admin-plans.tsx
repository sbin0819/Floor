import Link from "next/link";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdminPlansData } from "@/features/floor-plan/editor-types";

export function AdminPlansFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <header>
        <h1 className="text-2xl font-bold">평면도 편집</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          층을 골라 공간 도형을 바꿔요. 초안은 게시 전까지 멤버에게 보이지
          않아요.
        </p>
      </header>
      {children}
    </main>
  );
}
export function AdminPlansSkeleton() {
  return (
    <AdminPlansFrame>
      <div aria-busy="true" className="space-y-4">
        <div className="grid grid-cols-3 gap-4 border-b py-3 text-sm font-semibold">
          <span>층</span>
          <span>게시본</span>
          <span>초안</span>
        </div>
        {[0, 1, 2].map((key) => (
          <Skeleton key={key} className="h-20 w-full" />
        ))}
        <span role="status" className="sr-only">
          층별 평면도를 불러오고 있어요
        </span>
      </div>
    </AdminPlansFrame>
  );
}
export function AdminPlans({ data }: { data: AdminPlansData }) {
  const date = (value: string | null) =>
    value
      ? new Intl.DateTimeFormat("ko-KR", {
          timeZone: data.branch.timezone,
          month: "numeric",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(new Date(value))
      : "시각 미기록";
  return (
    <AdminPlansFrame>
      <h2 className="font-semibold">{data.branch.name}</h2>
      {data.floors.length ? (
        <ul className="divide-y rounded-xl border">
          {data.floors.map((floor) => (
            <li
              key={floor.id}
              className="flex flex-wrap items-center gap-5 p-5"
            >
              <h3 className="w-20 font-bold">{floor.name}</h3>
              <p className="min-w-40 flex-1 text-sm tabular-nums">
                {floor.published
                  ? `게시본 · 버전 ${floor.published.version} · ${date(floor.published.publishedAt)}`
                  : "게시본이 없어요"}
              </p>
              <p className="min-w-40 flex-1 text-sm text-muted-foreground tabular-nums">
                {floor.draft
                  ? `초안 · ${date(floor.draft.updatedAt)} ${floor.draft.updatedByName ?? ""}`
                  : "저장된 초안이 없어요"}
              </p>
              <Link
                href={`/admin/branches/${data.branch.id}/floors/${floor.id}/plan`}
                className="inline-flex min-h-11 items-center rounded-lg border px-4 font-medium"
                aria-label={`${floor.name} 평면도 편집`}
              >
                편집
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-xl border p-6 text-muted-foreground">
          아직 등록한 층이 없어요
        </p>
      )}
    </AdminPlansFrame>
  );
}
