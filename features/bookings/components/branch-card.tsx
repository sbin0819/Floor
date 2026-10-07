"use client";

import Link from "next/link";
import {
  ArrowRight,
  ChevronRight,
  LoaderCircle,
  MapPin,
  Star,
} from "lucide-react";
import { cn } from "cn";
import { LinkPending } from "@/components/link-pending";
import { SpacePhoto } from "@/components/photos/space-photo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { summarizeBranchWeek } from "@/features/bookings/branch-hours";
import type { BranchListItem } from "@/features/bookings/types";
import type { OperatingState } from "@/features/bookings/operating-state";

export function BranchOperatingStatus({ state }: { state: OperatingState }) {
  const text =
    state.status === "open"
      ? `영업 중 · ${state.hours?.close}까지`
      : state.status === "before_open"
        ? `${state.hours?.open}에 열어요`
        : state.status === "after_close"
          ? "오늘 영업이 끝났어요"
          : "쉬는 날이에요";
  return (
    <p className="flex items-center gap-2 text-sm tabular-nums">
      {state.status === "open" && (
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full bg-status-free-strong"
        />
      )}
      {text}
    </p>
  );
}

export function BranchCard({
  branch,
  pending = false,
  saving = false,
  onSetDefault,
}: {
  branch: BranchListItem;
  pending?: boolean;
  saving?: boolean;
  onSetDefault: () => void;
}) {
  const week = summarizeBranchWeek(
    branch.openHours,
    branch.operatingState.date,
  );
  const freeCount =
    branch.operatingState.status === "open" ? branch.freeSpaceCount : null;
  return (
    <article aria-label={branch.name} className="h-full min-w-0">
      <Card
        data-slot="branch-card"
        className="relative h-full min-w-0 gap-5 pt-0 has-data-[pending=true]:border-primary"
      >
        <div className="relative aspect-[16/6]">
          <SpacePhoto
            photo={branch.cover}
            type="branch"
            size="fill"
            sizes="(max-width: 767px) calc(100vw - 32px), (max-width: 1023px) calc(100vw - 64px), 478px"
            className="rounded-none"
          />
          <div className="absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
            <div className="rounded-full bg-card px-3 py-1.5 text-card-foreground">
              <BranchOperatingStatus state={branch.operatingState} />
            </div>
            {branch.isDefault && (
              <Badge
                variant="secondary"
                className="h-auto min-h-8 bg-card px-3 py-1.5 text-foreground"
              >
                <Star aria-hidden="true" />
                기본 지점
              </Badge>
            )}
          </div>
        </div>
        <CardContent className="space-y-5">
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3">
              <h2 className="min-w-0 text-xl font-bold break-words">
                <Link
                  href={`/branches/${branch.id}`}
                  className="after:absolute after:inset-0 after:z-10 after:rounded-xl after:content-[''] focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-ring"
                >
                  {branch.name}
                  <LinkPending />
                </Link>
              </h2>
              <ChevronRight
                aria-hidden="true"
                className="size-5 shrink-0 text-muted-foreground"
              />
            </div>
            <p className="flex items-start gap-2 text-sm text-muted-foreground">
              <MapPin aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
              {branch.address ?? "주소 정보가 없어요"}
            </p>
          </div>
          {branch.accessibleFloorCount === 0 ? (
            <p className="rounded-lg border border-border p-4 text-sm text-muted-foreground">
              이용할 수 있는 층이 아직 없어요
            </p>
          ) : (
            <dl className="grid grid-cols-3 divide-x divide-border rounded-lg border border-border">
              {[
                {
                  label: "이용할 수 있는 층",
                  value: `${branch.accessibleFloorCount}개`,
                },
                {
                  label: "예약할 수 있는 공간",
                  value: `${branch.bookableSpaceCount}곳`,
                },
                {
                  label: "지금 빈 공간",
                  value: freeCount === null ? "–" : `${freeCount}곳`,
                  free: freeCount !== null,
                },
              ].map(({ label, value, free }) => (
                <div
                  key={label}
                  className="flex min-w-0 flex-col gap-1 px-3 py-3"
                >
                  <dt className="order-2 text-xs text-muted-foreground">
                    {label}
                  </dt>
                  <dd
                    className={cn(
                      "text-xl font-semibold tabular-nums",
                      free && "text-status-free-foreground",
                    )}
                  >
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground">
              운영 시간
            </h3>
            <ul
              aria-label="요일별 운영 시간"
              className="grid grid-cols-7 gap-1"
            >
              {week.map(
                ({ day, label, hoursLabel, accessibleLabel, isToday }) => (
                  <li
                    key={day}
                    aria-current={isToday ? "date" : undefined}
                    className={cn(
                      "min-w-0 rounded-lg px-1 py-2 text-center",
                      isToday
                        ? "bg-foreground text-background"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    <span className="sr-only">{accessibleLabel}</span>
                    <span aria-hidden="true" className="block text-xs">
                      {label}
                    </span>
                    <span
                      aria-hidden="true"
                      className={cn(
                        "mt-1 block text-[10px] font-medium tabular-nums sm:text-xs",
                        !isToday && hoursLabel !== "쉼" && "text-foreground",
                      )}
                    >
                      {hoursLabel.includes("–") ? (
                        <>
                          <span className="inline-block">
                            {hoursLabel.split("–")[0]}
                          </span>
                          <wbr />
                          <span className="inline-block">
                            –{hoursLabel.split("–")[1]}
                          </span>
                        </>
                      ) : (
                        hoursLabel
                      )}
                    </span>
                  </li>
                ),
              )}
            </ul>
          </div>
        </CardContent>
        <CardFooter className="mt-auto min-h-[76px] flex-wrap justify-between gap-x-3 gap-y-2 py-3">
          {branch.isDefault ? (
            <p className="text-xs text-muted-foreground">
              홈과 공간 예약이 이 지점으로 먼저 열려요
            </p>
          ) : (
            <span className="relative z-20 inline-flex">
              <Button
                variant="outline"
                disabled={pending}
                aria-label={`${branch.name} 기본 지점으로 설정`}
                onClick={onSetDefault}
              >
                {pending && saving ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <Star aria-hidden="true" />
                )}
                {pending && saving ? "저장하고 있어요" : "기본 지점으로 설정"}
              </Button>
            </span>
          )}
          <span
            aria-hidden="true"
            className="ml-auto inline-flex items-center gap-2 text-sm text-muted-foreground"
          >
            공간 보기 <ArrowRight className="size-4" />
          </span>
        </CardFooter>
      </Card>
    </article>
  );
}
