"use client";

import Link from "next/link";
import { useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { deskPartLabels } from "@/features/bookings/desk-parts";
import { localDate } from "@/lib/time/zoned";
import { formatBookingTime, spaceTypeLabels } from "@/features/bookings/format";
import type { AdminBookingRow, AdminBookingsData } from "../booking-types";
import { adminBookingsHref, adminBookingStatus } from "../booking-presentation";
import { OperatorCancelDialog } from "./operator-cancel-dialog";

function BookingMenu({
  row,
  timezone,
}: {
  row: AdminBookingRow;
  timezone: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const openingDialog = useRef(false);
  return (
    <>
      <DropdownMenu
        onOpenChange={(next) => {
          if (next) openingDialog.current = false;
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            ref={trigger}
            aria-label={`${row.spaceName} 예약 동작`}
          >
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (openingDialog.current) event.preventDefault();
          }}
        >
          <DropdownMenuItem
            disabled={!row.canCancel}
            onSelect={() => {
              openingDialog.current = true;
              setOpen(true);
            }}
          >
            예약 취소
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {open && (
        <OperatorCancelDialog
          row={row}
          timezone={timezone}
          open={open}
          onOpenChange={setOpen}
          onReturnFocus={() => trigger.current?.focus()}
        />
      )}
    </>
  );
}
function FilterSelect({
  name,
  label,
  initial,
  options,
}: {
  name: string;
  label: string;
  initial: string;
  options: readonly { value: string; label: string }[];
}) {
  const id = useId();
  const [value, setValue] = useState(initial);
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select name={name} value={value} onValueChange={setValue}>
        <SelectTrigger id={id} className="min-h-11 min-w-28">
          <SelectValue>
            {options.find((option) => option.value === value)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
function Filters({
  data,
  navigate,
}: {
  data: AdminBookingsData;
  navigate: (url: string) => void;
}) {
  const id = useId();
  return (
    <form
      action={`/admin/branches/${data.branch.id}/bookings`}
      className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4"
      onSubmit={(event) => {
        event.preventDefault();
        const values = new FormData(event.currentTarget);
        const query = new URLSearchParams();
        for (const [key, value] of values)
          if (typeof value === "string" && value && value !== "any")
            query.set(key, value);
        navigate(`/admin/branches/${data.branch.id}/bookings?${query}`);
      }}
    >
      <div className="space-y-1">
        <Label htmlFor={`${id}-date`}>날짜</Label>
        <Input
          id={`${id}-date`}
          type="date"
          name="date"
          required
          defaultValue={data.filters.date}
          className="min-h-11 tabular-nums"
        />
      </div>
      <FilterSelect
        name="days"
        label="기간"
        initial={String(data.filters.days)}
        options={[
          { value: "1", label: "하루" },
          { value: "7", label: "7일" },
        ]}
      />
      <FilterSelect
        name="floor"
        label="층"
        initial={data.filters.floorId ?? "any"}
        options={[
          { value: "any", label: "전체 층" },
          ...data.floors.map(({ id, name }) => ({ value: id, label: name })),
        ]}
      />
      <FilterSelect
        name="type"
        label="종류"
        initial={data.filters.type ?? "any"}
        options={[
          { value: "any", label: "전체 종류" },
          ...Object.entries(spaceTypeLabels).map(([value, label]) => ({
            value,
            label,
          })),
        ]}
      />
      <FilterSelect
        name="status"
        label="상태"
        initial={data.filters.status}
        options={[
          { value: "confirmed", label: "확정" },
          { value: "cancelled", label: "취소됨" },
          { value: "all", label: "모두" },
        ]}
      />
      <div className="min-w-40 flex-1 space-y-1">
        <Label htmlFor={`${id}-q`}>예약 검색</Label>
        <Input
          id={`${id}-q`}
          name="q"
          defaultValue={data.filters.q}
          minLength={2}
          maxLength={40}
          placeholder="예약한 사람, 팀, 제목"
          className="min-h-11"
        />
      </div>
      <Button type="submit">찾기</Button>
    </form>
  );
}
function SpaceLabel({ row }: { row: AdminBookingRow }) {
  return (
    <>
      <p className="font-medium">
        {row.spaceType === "desk"
          ? `좌석 ${row.spaceName} · ${row.areaName ?? "데스크 구역"}`
          : row.spaceName}
      </p>
      <p className="text-xs text-muted-foreground">{row.floorName}</p>
    </>
  );
}
function Booker({ row }: { row: AdminBookingRow }) {
  return (
    <div className="flex items-center gap-2">
      <UserAvatar name={row.bookerName} avatar={row.avatar} size={32} />
      <div>
        <p>{row.bookerName}</p>
        {row.teamName && (
          <p className="text-xs text-muted-foreground">
            {row.teamName} 이름으로
          </p>
        )}
      </div>
    </div>
  );
}
const columns = [
  "시간",
  "공간 · 층",
  "예약한 사람",
  "제목",
  "인원",
  "상태",
  "동작",
];
export function AdminBookingsFrame({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-7xl space-y-6 p-4 lg:p-8">
      <header>
        <h1 className="text-2xl font-bold">예약 현황</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          지점의 예약을 살펴보고 취소할 수 있어요
        </p>
      </header>
      {children}
    </main>
  );
}
export function AdminBookingsSkeleton() {
  return (
    <AdminBookingsFrame>
      <div
        className="grid grid-cols-2 gap-3 rounded-xl border bg-card p-4 md:grid-cols-4"
        aria-label="예약 조건을 불러오는 중"
      >
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
        <Skeleton className="h-16" />
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((label) => (
                <TableHead key={label}>{label}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {[0, 1, 2].map((key) => (
              <TableRow key={key}>
                <TableCell colSpan={7}>
                  <Skeleton className="h-12" />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </AdminBookingsFrame>
  );
}
export function AdminBookings({ data }: { data: AdminBookingsData }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const time = (row: AdminBookingRow) =>
    `${data.filters.days === 7 ? `${localDate(new Date(row.start), data.branch.timezone).slice(5).replace("-", "/")} ` : ""}${row.deskPart ? `${deskPartLabels[row.deskPart]} ` : ""}${formatBookingTime(row.start, row.end, data.branch.timezone)}`;
  return (
    <AdminBookingsFrame>
      <Filters
        key={JSON.stringify(data.filters)}
        data={data}
        navigate={(url) => startTransition(() => router.push(url))}
      />
      <section
        aria-busy={pending}
        className={pending ? "opacity-50" : undefined}
      >
        <p className="mb-3 text-sm text-muted-foreground tabular-nums">
          {data.total}건 가운데{" "}
          {data.rows.length === 0
            ? "0"
            : `${(data.filters.page - 1) * 30 + 1}–${Math.min(data.filters.page * 30, data.total)}`}
        </p>
        {data.rows.length === 0 ? (
          <p className="rounded-xl border bg-card p-8 text-center text-muted-foreground">
            조건에 맞는 예약이 없어요
          </p>
        ) : (
          <>
            <div className="hidden overflow-hidden rounded-xl border bg-card lg:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((label) => (
                      <TableHead key={label}>{label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell className="whitespace-nowrap tabular-nums">
                        {time(row)}
                      </TableCell>
                      <TableCell>
                        <SpaceLabel row={row} />
                      </TableCell>
                      <TableCell>
                        <Booker row={row} />
                      </TableCell>
                      <TableCell className="max-w-56 break-words whitespace-normal">
                        {row.title ?? "—"}
                      </TableCell>
                      <TableCell className="tabular-nums">
                        {row.attendeeCount ?? row.participantCount + 1}명
                      </TableCell>
                      <TableCell title={row.cancelReason ?? undefined}>
                        {adminBookingStatus(row)}
                      </TableCell>
                      <TableCell>
                        <BookingMenu
                          row={row}
                          timezone={data.branch.timezone}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="space-y-3 lg:hidden">
              {data.rows.map((row) => (
                <li
                  key={row.id}
                  className="space-y-3 rounded-xl border bg-card p-4"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="mb-1 tabular-nums">{time(row)}</p>
                      <SpaceLabel row={row} />
                    </div>
                    <BookingMenu row={row} timezone={data.branch.timezone} />
                  </div>
                  <Booker row={row} />
                  <p className="break-words">
                    {row.title ?? "제목 없음"} ·{" "}
                    <span className="tabular-nums">
                      {row.attendeeCount ?? row.participantCount + 1}명
                    </span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {adminBookingStatus(row)}
                    {row.cancelReason ? ` · ${row.cancelReason}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </>
        )}
        <nav aria-label="예약 페이지" className="mt-4 flex justify-end gap-3">
          {data.filters.page > 1 && (
            <Button asChild variant="outline">
              <Link
                href={adminBookingsHref(data.branch.id, {
                  ...data.filters,
                  page: data.filters.page - 1,
                })}
              >
                이전
              </Link>
            </Button>
          )}
          {data.filters.page * 30 < data.total && (
            <Button asChild variant="outline">
              <Link
                href={adminBookingsHref(data.branch.id, {
                  ...data.filters,
                  page: data.filters.page + 1,
                })}
              >
                다음
              </Link>
            </Button>
          )}
        </nav>
      </section>
    </AdminBookingsFrame>
  );
}
