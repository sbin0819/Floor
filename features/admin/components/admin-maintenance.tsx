import Link from "next/link";
import { MoreHorizontal, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatBookingTime } from "@/features/bookings/format";
import { localDate } from "@/lib/time/zoned";
import { maintenanceHref } from "../maintenance-navigation";
import type { MaintenanceListData } from "../maintenance-types";

export function AdminMaintenanceFrame({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
      <header className="sticky top-[var(--admin-mobile-header-height,0px)] z-30 bg-background py-2">
        <h1 className="text-2xl font-bold">점검</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          공간의 점검 시간을 관리해요
        </p>
      </header>
      {children}
    </main>
  );
}
const columns = ["공간 · 층", "기간", "이유", "상태", "등록한 사람", "동작"];
export function AdminMaintenanceSkeleton() {
  return (
    <AdminMaintenanceFrame>
      <div className="flex gap-4 text-sm">
        <span>진행 중·예정</span>
        <span>지난 30일</span>
      </div>
      <div aria-busy="true" className="rounded-lg border p-4">
        <span role="status" className="sr-only">
          점검을 불러오고 있어요
        </span>
        <div className="hidden lg:block">
          <table className="w-full">
            <thead>
              <tr>
                {columns.map((column) => (
                  <th
                    key={column}
                    className="p-2 text-left text-sm font-medium"
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>
        <div className="space-y-3 pt-4">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} className="h-16 w-full" />
          ))}
        </div>
      </div>
    </AdminMaintenanceFrame>
  );
}
function Period({
  row,
  timezone,
}: {
  row: MaintenanceListData["rows"][number];
  timezone: string;
}) {
  const start = localDate(new Date(row.start), timezone);
  const end = localDate(new Date(row.end), timezone);
  return (
    <span className="tabular-nums">
      {start}
      {start === end ? "" : ` → ${end}`}
      <br />
      {formatBookingTime(row.start, row.end, timezone)}
    </span>
  );
}
function RowActions({
  row,
  data,
}: {
  row: MaintenanceListData["rows"][number];
  data: MaintenanceListData;
}) {
  if (row.state === "past") return null;
  const values = { tab: data.tab, block: row.id };
  return (
    <div className="flex items-center gap-1" data-maintenance-trigger={row.id}>
      <Button variant="outline" asChild>
        <Link
          aria-label={`${row.state === "ongoing" ? "해제" : "고치기"} · ${row.space.name}`}
          href={maintenanceHref(data.branch.id, {
            ...values,
            dialog: row.state === "ongoing" ? "end" : "edit",
          })}
          scroll={false}
          prefetch={false}
        >
          {row.state === "ongoing" ? "해제" : "고치기"}
          <span className="sr-only"> · {row.space.name}</span>
        </Link>
      </Button>
      {row.state === "upcoming" && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={`${row.space.name} 점검 동작`}
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild>
              <Link
                href={maintenanceHref(data.branch.id, {
                  ...values,
                  dialog: "delete",
                })}
                scroll={false}
                prefetch={false}
              >
                지우기
              </Link>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
export function AdminMaintenance({
  data,
  children,
}: {
  data: MaintenanceListData;
  children?: ReactNode;
}) {
  return (
    <AdminMaintenanceFrame>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav
          aria-label="점검 보기"
          className="flex gap-1 rounded-lg bg-muted p-1 text-sm"
        >
          {(["active", "past"] as const).map((tab) => (
            <Link
              key={tab}
              href={maintenanceHref(data.branch.id, { tab })}
              scroll={false}
              aria-current={data.tab === tab ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-md px-3 ${data.tab === tab ? "bg-background font-medium shadow-sm" : "text-muted-foreground"}`}
            >
              {tab === "active" ? (
                <>
                  진행 중·예정{" "}
                  <span className="ml-1 tabular-nums">{data.activeCount}</span>
                </>
              ) : (
                "지난 30일"
              )}
            </Link>
          ))}
        </nav>
        <Button asChild>
          <Link
            data-maintenance-create
            href={maintenanceHref(data.branch.id, {
              tab: data.tab,
              dialog: "create",
            })}
            scroll={false}
            prefetch={false}
          >
            <Plus aria-hidden="true" />
            점검 등록
          </Link>
        </Button>
      </div>
      {!data.rows.length ? (
        <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          {data.tab === "active"
            ? "진행 중이거나 예정된 점검이 없어요"
            : "지난 30일 동안 끝난 점검이 없어요"}
        </p>
      ) : (
        <>
          <div className="hidden overflow-hidden rounded-lg border lg:block">
            <table className="w-full text-left text-sm">
              <thead className="border-b">
                <tr>
                  {columns.map((column) => (
                    <th key={column} className="p-4 font-medium">
                      {column}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.rows.map((row) => (
                  <tr key={row.id}>
                    <td className="p-4">
                      <p className="font-medium">{row.space.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {row.space.floorName}
                      </p>
                    </td>
                    <td className="p-4">
                      <Period row={row} timezone={data.branch.timezone} />
                    </td>
                    <td className="max-w-xs p-4 break-words">
                      {row.reason ?? "—"}
                    </td>
                    <td className="p-4 whitespace-nowrap">
                      {stateName(row.state)}
                    </td>
                    <td className="p-4">{row.createdByName}</td>
                    <td className="p-4">
                      <RowActions data={data} row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-3 lg:hidden" aria-label="점검 목록">
            {data.rows.map((row) => (
              <li
                key={row.id}
                className="space-y-3 rounded-lg border bg-card p-4 text-sm"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-semibold">
                    {row.space.name} · {row.space.floorName}
                  </p>
                  <span className="shrink-0">{stateName(row.state)}</span>
                </div>
                <Period row={row} timezone={data.branch.timezone} />
                <p className="break-words">{row.reason ?? "이유 없음"}</p>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-muted-foreground">
                    등록 · {row.createdByName}
                  </span>
                  <RowActions data={data} row={row} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      {children}
    </AdminMaintenanceFrame>
  );
}
function stateName(state: MaintenanceListData["rows"][number]["state"]) {
  return state === "ongoing"
    ? "진행 중"
    : state === "upcoming"
      ? "예정"
      : "지남";
}
