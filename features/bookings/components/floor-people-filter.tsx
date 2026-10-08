"use client";

import { useEffect, type ComponentProps } from "react";
import { Minus, Plus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { shouldInterceptNavigation } from "@/components/optimistic-navigation";
import { floorHref } from "@/features/bookings/format";
import {
  parsePeopleFilter,
  peopleFilterHref,
} from "@/features/bookings/people-filter";
import { searchValue } from "@/features/bookings/floor-selection";
import { cn } from "@/lib/utils";
import { useFloorSelection } from "./branch-workspace";
import { useFloorPeople } from "./floor-view";

function pushPeopleHistory(people: number | null) {
  window.history.pushState(
    null,
    "",
    peopleFilterHref(window.location.href, people),
  );
}

export function FloorPeopleLink({
  people,
  href,
  ...props
}: Omit<ComponentProps<"a">, "onClick" | "href"> & {
  people: number | null;
  href: string;
}) {
  const selection = useFloorSelection();
  const { setOverride } = useFloorPeople();
  return (
    <a
      {...props}
      href={peopleFilterHref(href, people)}
      onClick={(event) => {
        if (!shouldInterceptNavigation(event)) return;
        event.preventDefault();
        if (!selection?.isCurrentRoute()) return;
        setOverride?.(people);
        if (!selection.navigationPending) pushPeopleHistory(people);
      }}
    />
  );
}

export function FloorPeopleControl({ className }: { className?: string }) {
  const selection = useFloorSelection();
  const { people, override, setOverride } = useFloorPeople();
  const current = parsePeopleFilter(
    searchValue(selection?.search ?? new URLSearchParams(), "people"),
  );
  const pending = selection?.navigationPending ?? false;
  const routeActive = selection?.routeActive ?? false;
  const isCurrentRoute = selection?.isCurrentRoute;
  useEffect(() => {
    if (override === undefined) return;
    if (!routeActive || !isCurrentRoute?.()) {
      setOverride?.(undefined);
      return;
    }
    if (pending) return;
    if (current === override) {
      setOverride?.(undefined);
      return;
    }
    // 서버 이동을 취소하지 않도록 완료된 주소에 마지막 인원 조건만 합친다.
    if (
      parsePeopleFilter(
        new URL(window.location.href).searchParams.get("people"),
      ) !== override
    )
      pushPeopleHistory(override);
  }, [current, override, pending, routeActive, isCurrentRoute, setOverride]);
  useEffect(() => {
    const clear = () => setOverride?.(undefined);
    window.addEventListener("popstate", clear);
    return () => {
      window.removeEventListener("popstate", clear);
      clear();
    };
  }, [setOverride]);
  if (!selection?.location.floorId) return null;
  const href = `${floorHref(selection.branchId, selection.location.floorId)}?${selection.search}`;
  return (
    <div
      role="group"
      aria-label="인원으로 거르기"
      className={cn(
        "flex w-fit shrink-0 items-center rounded-lg border bg-card px-1 text-sm shadow-card",
        people === null ? "border-border" : "border-primary",
        className,
      )}
    >
      <span className="flex items-center gap-1.5 pl-2 text-muted-foreground">
        <Users aria-hidden="true" className="size-4" />
        인원
      </span>
      {people === null ? (
        <span
          aria-disabled="true"
          aria-label="한 명 줄이기"
          className="flex size-11 items-center justify-center text-muted-foreground/50"
        >
          <Minus aria-hidden="true" className="size-4" />
        </span>
      ) : (
        <Button asChild variant="ghost" size="icon">
          <FloorPeopleLink
            href={href}
            people={people === 2 ? null : people - 1}
            aria-label="한 명 줄이기"
          >
            <Minus aria-hidden="true" />
          </FloorPeopleLink>
        </Button>
      )}
      <span
        className="min-w-10 text-center font-medium tabular-nums"
        aria-live="polite"
      >
        {people === null ? "전체" : `${people}명`}
      </span>
      {people === 50 ? (
        <span
          aria-disabled="true"
          aria-label="한 명 늘리기"
          className="flex size-11 items-center justify-center text-muted-foreground/50"
        >
          <Plus aria-hidden="true" className="size-4" />
        </span>
      ) : (
        <Button asChild variant="ghost" size="icon">
          <FloorPeopleLink
            href={href}
            people={people === null ? 2 : people + 1}
            aria-label="한 명 늘리기"
          >
            <Plus aria-hidden="true" />
          </FloorPeopleLink>
        </Button>
      )}
      {people !== null && (
        <Button asChild variant="ghost" size="icon">
          <FloorPeopleLink
            href={href}
            people={null}
            aria-label="인원 조건 지우기"
          >
            <X aria-hidden="true" />
          </FloorPeopleLink>
        </Button>
      )}
    </div>
  );
}

export function FloorPeopleNotice({
  people,
  hiddenCount,
  href,
}: {
  people: number;
  hiddenCount: number;
  href: string;
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg bg-accent px-4 py-2 text-sm text-accent-foreground tabular-nums"
    >
      <p>
        {people}명이 쓸 수 있는 공간만 보여요
        {hiddenCount > 0 && ` · 숨긴 공간 ${hiddenCount}곳`}
      </p>
      <FloorPeopleLink
        href={href}
        people={null}
        className="flex min-h-11 items-center font-medium underline underline-offset-4"
      >
        모두 보기
      </FloorPeopleLink>
    </div>
  );
}
