import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { UserAvatar } from "@/components/user-avatar";
import type { AdminDashboardData } from "../dashboard-types";
import { AdminDashboardFilters } from "./admin-dashboard-filters";
import { AdminDashboardPlan } from "./admin-dashboard-plan";
import { MaintenanceEndButton } from "./maintenance-end-button";
import {
  dashboardComparison,
  dashboardDate,
  dashboardHref,
  dashboardPercent,
  dashboardRangeLabels,
  dashboardRelativeTime,
  dashboardTime,
} from "./admin-dashboard-format";

function DashboardFrame({ children }: { children: ReactNode }) {
  return (
    <main className="min-w-0">
      <header className="sticky top-[var(--admin-mobile-header-height,0px)] z-30 border-b bg-card px-4 py-5 lg:px-8">
        <h1 className="text-xl font-bold">대시보드</h1>
      </header>
      <div className="mx-auto max-w-[1600px] space-y-5 p-4 lg:p-8">
        {children}
      </div>
    </main>
  );
}
function Card({
  title,
  children,
  detail,
}: {
  title: string;
  children: ReactNode;
  detail?: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="min-w-0 space-y-3 rounded-xl border bg-card p-5 shadow-card"
    >
      <h2 className="text-sm text-muted-foreground">{title}</h2>
      <div className="text-[28px] font-bold tracking-tight tabular-nums">
        {children}
      </div>
      <div className="min-h-5 text-xs text-muted-foreground tabular-nums">
        {detail}
      </div>
    </section>
  );
}
function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={title}
      className="min-w-0 overflow-hidden rounded-xl border bg-card shadow-card"
    >
      <div className="flex min-h-16 flex-wrap items-center justify-between gap-x-3 px-5 py-2">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
function HeatLegend() {
  return (
    <ul
      aria-label="이용률 범례"
      className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground tabular-nums"
    >
      {[
        ["bg-heat-1", "0–24%"],
        ["bg-heat-2", "25–49%"],
        ["bg-heat-3", "50–74%"],
        ["bg-heat-4", "75–100%"],
        ["bg-status-maintenance-hatch", "이용률 없음"],
      ].map(([color, label]) => (
        <li key={label} className="flex items-center gap-1">
          <span
            aria-hidden
            className={`inline-block h-3 w-4 rounded-sm border ${color}`}
          />
          {label}
        </li>
      ))}
    </ul>
  );
}
function Utilization({ data }: { data: AdminDashboardData }) {
  const floor = data.floors.find(({ id }) => id === data.floorId);
  return (
    <Section
      title={`${floor ? `${floor.name} 공간별` : "층별"} 이용률 · ${dashboardRangeLabels[data.range]}`}
    >
      <div className="space-y-4 px-5 pb-5">
        <HeatLegend />
        {data.floorId === null ? (
          <ul className="space-y-5 py-4">
            {data.floors.map((item) => (
              <li key={item.id}>
                <Link
                  prefetch={false}
                  href={dashboardHref(data, { floorId: item.id })}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span>{item.name}</span>
                  <span className="text-sm font-semibold tabular-nums">
                    {dashboardPercent(item.utilization)}
                  </span>
                </Link>
                <div
                  aria-hidden
                  className="h-3 overflow-hidden rounded-full bg-muted"
                >
                  <div
                    className="h-full rounded-full bg-heat-4"
                    style={{ width: `${(item.utilization ?? 0) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : data.plan ? (
          <AdminDashboardPlan plan={data.plan} spaces={data.spaces} />
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              게시된 평면도가 없어 공간별 이용률을 표로 보여드려요.
            </p>
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-3 font-medium">공간</th>
                  <th className="py-3 text-right font-medium">이용률</th>
                </tr>
              </thead>
              <tbody>
                {data.spaces
                  .filter(
                    (space) =>
                      space.floorId === data.floorId && space.type !== "desk",
                  )
                  .map((space) => (
                    <tr key={space.id} className="border-b last:border-0">
                      <th className="py-3 font-normal">{space.name}</th>
                      <td className="py-3 text-right tabular-nums">
                        {dashboardPercent(space.utilization)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </>
        )}
        {data.floors.length === 0 && (
          <p className="text-sm text-muted-foreground">등록된 층이 없어요.</p>
        )}
        <p className="text-xs leading-relaxed text-muted-foreground">
          운영 시간 가운데 예약된 시간의 비율이에요. 오픈 데스크는 좌석
          평균이며, 라운지처럼 예약하지 않는 공간은 빈칸이에요. 실제 사용과 다를
          수 있어요.
        </p>
      </div>
    </Section>
  );
}
function Upcoming({ data }: { data: AdminDashboardData }) {
  return (
    <Section
      title="다음 2시간"
      action={
        <Link
          prefetch={false}
          href={`/admin/branches/${data.branch.id}/bookings`}
          className="inline-flex min-h-11 items-center gap-1 rounded-sm text-xs font-medium text-primary focus-visible:outline-2 focus-visible:outline-ring"
        >
          예약 현황
          <ArrowRight className="size-3" />
        </Link>
      }
    >
      {data.upcoming.length ? (
        <ul className="divide-y">
          {data.upcoming.slice(0, 4).map((booking) => (
            <li key={booking.id} className="flex items-center gap-3 px-5 py-4">
              <time
                dateTime={booking.start}
                className="shrink-0 font-semibold tabular-nums"
              >
                {dashboardTime(booking.start, data.branch.timezone)}
              </time>
              <div className="min-w-0 flex-1">
                <p className="font-medium break-words">
                  {booking.spaceName}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    · {booking.floorName}
                  </span>
                </p>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <UserAvatar
                    name={booking.booker.name}
                    avatar={booking.booker.avatar}
                    size={20}
                  />
                  <span className="break-words">
                    {booking.booker.name}
                    {booking.teamName && ` · ${booking.teamName}`}
                  </span>
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {booking.attendeeCount}명
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 pb-5 text-sm text-muted-foreground">
          다음 2시간 안에 시작하는 예약이 없어요.
        </p>
      )}
    </Section>
  );
}
function Maintenance({ data }: { data: AdminDashboardData }) {
  return (
    <Section
      title="점검"
      action={
        data.canManageMaintenance ? (
          <Link
            href={`/admin/branches/${data.branch.id}/maintenance?create=1`}
            className="flex min-h-11 items-center rounded-sm px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring"
          >
            + 등록
          </Link>
        ) : undefined
      }
    >
      {data.maintenance.length ? (
        <ul className="divide-y">
          {data.maintenance.map((item) => (
            <li key={item.id} className="flex gap-3 px-5 py-4">
              <span
                aria-hidden
                className="mt-1 size-8 shrink-0 rounded-lg border bg-status-maintenance-hatch"
              />
              <div className="min-w-0 flex-1 space-y-1">
                <p className="font-medium break-words">
                  {item.spaceName} · {item.floorName}
                  {item.reason && ` · ${item.reason}`}
                </p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {dashboardRelativeTime(
                    item.start,
                    data.now,
                    data.branch.timezone,
                  )}{" "}
                  –{" "}
                  {dashboardRelativeTime(
                    item.end,
                    data.now,
                    data.branch.timezone,
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {item.status === "ongoing" ? "진행 중" : "예정"}
                </p>
              </div>
              {data.canManageMaintenance && item.status === "ongoing" && (
                <MaintenanceEndButton
                  blockId={item.id}
                  spaceName={item.spaceName}
                />
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 pb-5 text-sm text-muted-foreground">
          진행 중이거나 7일 안에 예정된 점검이 없어요.
        </p>
      )}
    </Section>
  );
}
export function AdminDashboard({ data }: { data: AdminDashboardData }) {
  const firstMaintenance = data.maintenance.find(
    ({ status }) => status === "ongoing",
  );
  return (
    <DashboardFrame>
      <div>
        <p className="text-sm text-muted-foreground">
          {data.branch.name} · {dashboardDate(data.date)}
        </p>
        <h2 className="mt-1 text-[26px] font-bold tracking-tight">
          {data.isToday ? "오늘의" : "선택한 날의"} {data.branch.name}
        </h2>
      </div>
      <AdminDashboardFilters data={data}>
        <div className="space-y-5">
          <div className="grid grid-cols-1 gap-4 min-[390px]:grid-cols-2 xl:grid-cols-3">
            <Card
              title={data.isToday ? "오늘 예약" : "기준일 예약"}
              detail={
                data.isToday &&
                data.cards.ongoingCount !== null &&
                data.cards.remainingCount !== null
                  ? `진행 중 ${data.cards.ongoingCount} · 남은 ${data.cards.remainingCount}`
                  : undefined
              }
            >
              {data.cards.bookingCount}건
            </Card>
            <Card
              title="회의실 이용률"
              detail={dashboardComparison(
                data.cards.meetingUtilization,
                data.cards.previousMeetingUtilization,
                data.range,
              )}
            >
              <span
                className={
                  data.cards.meetingUtilization === null ? "text-lg" : undefined
                }
              >
                {dashboardPercent(data.cards.meetingUtilization)}
              </span>
            </Card>
            <Card
              title="점검 중"
              detail={
                firstMaintenance &&
                `${firstMaintenance.spaceName} · ${dashboardRelativeTime(firstMaintenance.end, data.now, data.branch.timezone)}까지`
              }
            >
              {data.cards.maintenanceCount}곳
            </Card>
          </div>
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
            <Utilization data={data} />
            <div className="space-y-5">
              <Upcoming data={data} />
              <Maintenance data={data} />
            </div>
          </div>
        </div>
      </AdminDashboardFilters>
    </DashboardFrame>
  );
}
export function AdminDashboardSkeleton() {
  return (
    <DashboardFrame>
      <div aria-busy="true" className="space-y-5">
        <span role="status" className="sr-only">
          대시보드를 불러오고 있어요
        </span>
        <Skeleton className="h-12 w-52" />
        <div className="flex flex-wrap gap-3">
          <Skeleton className="h-11 w-44" />
          <Skeleton className="h-11 w-52" />
        </div>
        <div className="grid grid-cols-1 gap-4 min-[390px]:grid-cols-2 xl:grid-cols-3">
          {["오늘 예약", "회의실 이용률", "점검 중"].map((title) => (
            <Card
              key={title}
              title={title}
              detail={<Skeleton className="h-4 w-28" />}
            >
              <Skeleton className="h-9 w-20" />
            </Card>
          ))}
        </div>
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <Section title="공간별 이용률">
            <Skeleton className="mx-5 mb-5 h-96" />
          </Section>
          <div className="space-y-5">
            {["다음 2시간", "점검"].map((title) => (
              <Section key={title} title={title}>
                <Skeleton className="mx-5 mb-5 h-32" />
              </Section>
            ))}
          </div>
        </div>
      </div>
    </DashboardFrame>
  );
}
