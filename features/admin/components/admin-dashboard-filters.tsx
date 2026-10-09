"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useOptimistic, useState, useTransition, type ReactNode } from "react";
import { SegmentedLink, SegmentedLinks } from "@/components/segmented-links";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AdminDashboardData, DashboardRange } from "../dashboard-types";
import { dashboardHref, dashboardRangeLabels } from "./admin-dashboard-format";

export function AdminDashboardFilters({
  data,
  children,
}: {
  data: AdminDashboardData;
  children: ReactNode;
}) {
  const router = useRouter();
  const [dateInput, setDateInput] = useState({
    date: data.date,
    value: data.date,
  });
  const [selection, select] = useOptimistic({
    date: data.date,
    range: data.range,
    floorId: data.floorId,
  });
  const [pending, startTransition] = useTransition();
  const navigate = (change: Partial<typeof selection>) => {
    const next = { ...selection, ...change };
    startTransition(() => {
      select(next);
      router.push(dashboardHref(data, next), { scroll: false });
    });
  };
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-wrap gap-3">
          <SegmentedLinks label="대시보드 층">
            {[{ id: null, name: "전체" }, ...data.floors].map((floor) => (
              <SegmentedLink
                key={floor.id ?? "all"}
                selected={selection.floorId === floor.id}
                asChild
              >
                <Link
                  href={dashboardHref(data, {
                    ...selection,
                    floorId: floor.id,
                  })}
                  prefetch={false}
                  scroll={false}
                  onNavigate={(event) => {
                    event.preventDefault();
                    navigate({ floorId: floor.id });
                  }}
                >
                  {floor.name}
                </Link>
              </SegmentedLink>
            ))}
          </SegmentedLinks>
          <SegmentedLinks label="대시보드 기간">
            {(Object.keys(dashboardRangeLabels) as DashboardRange[]).map(
              (range) => (
                <SegmentedLink
                  key={range}
                  selected={selection.range === range}
                  asChild
                >
                  <Link
                    href={dashboardHref(data, { ...selection, range })}
                    prefetch={false}
                    scroll={false}
                    onNavigate={(event) => {
                      event.preventDefault();
                      navigate({ range });
                    }}
                  >
                    {dashboardRangeLabels[range]}
                  </Link>
                </SegmentedLink>
              ),
            )}
          </SegmentedLinks>
        </div>
        <form
          className="flex max-w-full items-end gap-2"
          action={`/admin/branches/${data.branch.id}`}
          onSubmit={(event) => {
            event.preventDefault();
            const date = new FormData(event.currentTarget).get("date");
            if (typeof date === "string" && date) navigate({ date });
          }}
        >
          <label className="min-w-0 space-y-1 text-xs text-muted-foreground">
            기준일
            <Input
              type="date"
              name="date"
              required
              value={dateInput.date === data.date ? dateInput.value : data.date}
              onChange={(event) =>
                setDateInput({ date: data.date, value: event.target.value })
              }
              className="h-11 w-40 bg-card tabular-nums"
            />
          </label>
          <input type="hidden" name="range" value={selection.range} />
          {selection.floorId && (
            <input type="hidden" name="floor" value={selection.floorId} />
          )}
          <Button type="submit" variant="outline">
            적용
          </Button>
        </form>
      </div>
      <div
        aria-busy={pending || undefined}
        className={pending ? "opacity-60" : undefined}
      >
        {pending && (
          <span role="status" className="sr-only">
            대시보드를 불러오고 있어요
          </span>
        )}
        {children}
      </div>
    </>
  );
}
