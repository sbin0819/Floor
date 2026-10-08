import { SkeletonRegion } from "@/components/skeleton-region";
import { SkeletonFields } from "@/components/skeleton-shapes";
import { Skeleton } from "@/components/ui/skeleton";

export function AdminNavSkeleton() {
  return (
    <SkeletonRegion className="space-y-2">
      <Skeleton className="h-11 w-full bg-sidebar-accent" />
      <Skeleton className="h-11 w-full bg-sidebar-accent" />
    </SkeletonRegion>
  );
}

export function AdminBreadcrumbSkeleton({ depth = 1 }: { depth?: 1 | 2 | 3 }) {
  return (
    <div
      aria-hidden="true"
      data-slot="skeleton-breadcrumb"
      className="flex min-h-11 items-center gap-3"
    >
      {Array.from({ length: depth }, (_, index) => (
        <Skeleton key={index} className="h-5 w-16" />
      ))}
    </div>
  );
}

export function AdminHomeSkeleton() {
  return (
    <SkeletonRegion className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
      <AdminBreadcrumbSkeleton />
      <h1 className="text-2xl font-semibold">운영자 화면</h1>
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">운영 지점</h2>
        <AdminBranchCardShapes />
      </div>
    </SkeletonRegion>
  );
}

function AdminBranchCardShapes() {
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      {[0, 1].map((index) => (
        <div
          key={index}
          data-slot="skeleton-branch-card"
          className="space-y-5 rounded-xl border bg-card p-5"
        >
          <Skeleton className="h-7 w-28" />
          <Skeleton className="h-5 w-44 max-w-full" />
          <Skeleton className="h-5 w-32" />
          <div className="border-t pt-4">
            <Skeleton className="h-5 w-36" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function AdminBranchCardsSkeleton() {
  return (
    <SkeletonRegion>
      <AdminBranchCardShapes />
    </SkeletonRegion>
  );
}

export function AdminBranchSkeleton() {
  return (
    <SkeletonRegion className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
      <AdminBreadcrumbSkeleton depth={2} />
      <Skeleton className="h-8 w-40" />
      <div className="space-y-5 rounded-xl border bg-card p-5">
        <h2 className="text-lg font-semibold">지점 정보</h2>
        <SkeletonFields count={2} />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      <div className="space-y-5 rounded-xl border bg-card p-5">
        <h2 className="text-lg font-semibold">운영 시간</h2>
        <Skeleton className="h-11 w-64 max-w-full" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[340px] border-collapse text-left text-sm">
            <caption className="sr-only">요일별 운영 시간</caption>
            <thead>
              <tr>
                {["요일", "쉬는 날", "시작", "끝"].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className="p-2 font-medium text-muted-foreground"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[
                "월요일",
                "화요일",
                "수요일",
                "목요일",
                "금요일",
                "토요일",
                "일요일",
              ].map((day) => (
                <tr key={day} data-slot="skeleton-hours-row">
                  <th scope="row" className="p-2 font-medium whitespace-nowrap">
                    {day}
                  </th>
                  <td className="p-2">
                    <Skeleton className="h-6 w-12 rounded-full" />
                  </td>
                  <td className="p-2">
                    <Skeleton className="h-11 w-full" />
                  </td>
                  <td className="p-2">
                    <Skeleton className="h-11 w-full" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <Skeleton className="h-11 w-36" />
      <div className="space-y-4 rounded-xl border bg-card p-5">
        <h2 className="text-lg font-semibold">층</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[340px] border-collapse text-left text-sm">
            <caption className="sr-only">층 목록</caption>
            <thead>
              <tr>
                {["층 번호", "이름", "이용 대상", "공간 수"].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className="p-3 font-medium text-muted-foreground"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[0, 1].map((index) => (
                <tr key={index} data-slot="skeleton-row" className="border-t">
                  <td className="p-3">
                    <Skeleton className="h-11 w-12" />
                  </td>
                  <td className="p-3">
                    <Skeleton className="h-5 w-full" />
                  </td>
                  <td className="p-3">
                    <Skeleton className="h-5 w-full rounded-full" />
                  </td>
                  <td className="p-3">
                    <Skeleton className="h-5 w-12" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SkeletonRegion>
  );
}

export function AdminFloorSkeleton() {
  return (
    <SkeletonRegion className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <AdminBreadcrumbSkeleton depth={3} />
      <Skeleton className="h-8 w-40" />
      <div className="grid gap-6 xl:grid-cols-2">
        <div className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="text-lg font-semibold">층 정보</h2>
          <SkeletonFields count={3} />
          <Skeleton className="h-11 w-28" />
        </div>
        <div className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="font-semibold">층 이용 대상</h2>
          <SkeletonFields count={2} />
          <Skeleton className="h-11 w-28" />
        </div>
      </div>
      <div className="space-y-4 rounded-xl border bg-card p-5">
        <h2 className="text-lg font-semibold">공간</h2>
        <Skeleton className="h-5 w-24" />
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] border-collapse text-left text-sm">
            <caption className="sr-only">공간 관리</caption>
            <thead>
              <tr>
                {[
                  "이름",
                  "정원",
                  "예약 가능",
                  "편의 시설",
                  "이용 대상",
                  "동작",
                ].map((label) => (
                  <th
                    key={label}
                    scope="col"
                    className="p-3 font-medium text-muted-foreground"
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[0, 1, 2].map((row) => (
                <tr
                  key={row}
                  data-slot="skeleton-row"
                  className="border-b last:border-b-0"
                >
                  <td className="p-3">
                    <Skeleton className="h-5 w-full" />
                  </td>
                  <td className="p-3">
                    <Skeleton className="h-5 w-8" />
                  </td>
                  <td className="p-3">
                    <Skeleton className="size-4" />
                  </td>
                  <td className="p-3">
                    <Skeleton className="h-5 w-full" />
                  </td>
                  <td className="p-3">
                    <Skeleton className="h-5 w-full rounded-full" />
                  </td>
                  <td className="p-3">
                    <Skeleton className="size-11" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </SkeletonRegion>
  );
}
