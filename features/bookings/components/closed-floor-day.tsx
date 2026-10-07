"use client";

import Link from "next/link";
import { CalendarOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { nextOpenDate } from "@/features/bookings/next-open-date";
import { floorHref } from "@/features/bookings/format";
import type { FloorDayData } from "@/features/bookings/types";
import { localDate } from "@/lib/time/zoned";
import { FloorNavigationLink } from "./floor-navigation-link";

export function ClosedFloorDay({ data }: { data: FloorDayData }) {
  const next = nextOpenDate({
    date: data.date,
    today: localDate(new Date(data.now), data.branch.timezone),
    openHours: data.branch.openHours,
  });
  return (
    <section
      aria-label="쉬는 날 안내"
      className="flex min-h-72 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-border bg-card p-8 text-center"
    >
      <CalendarOff
        aria-hidden="true"
        className="size-8 text-muted-foreground"
      />
      <h2 className="text-lg font-bold">이 날은 쉬는 날이에요</h2>
      {next ? (
        <Button asChild variant="outline">
          <FloorNavigationLink
            href={floorHref(data.branch.id, data.floor.id, next)}
            location={{ floorId: data.floor.id, date: next, spaceId: null }}
          >
            다음 영업일 보기
          </FloorNavigationLink>
        </Button>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            운영 예정 시간이 없어요
          </p>
          <Button asChild variant="outline">
            <Link href="/branches">지점 바꾸기</Link>
          </Button>
        </>
      )}
    </section>
  );
}
