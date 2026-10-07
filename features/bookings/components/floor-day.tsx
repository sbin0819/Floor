import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { amenityLabels, type AmenityKey } from "@/lib/spaces/amenities";
import { addDays } from "@/lib/time/zoned";
import {
  floorHref,
  formatBookingDate,
  spaceTypeLabels,
} from "@/features/bookings/format";
import type { FloorDayData, SpaceType } from "@/features/bookings/types";

const types: SpaceType[] = [
  "meeting_room",
  "seminar",
  "phone_booth",
  "desk_area",
  "lounge",
];
export function FloorDay({
  data,
  today,
  selectedSpaceId,
  children,
}: {
  data: FloorDayData;
  today: string;
  selectedSpaceId?: string;
  children?: ReactNode;
}) {
  const link = (date: string) =>
    floorHref(data.branch.id, data.floor.id, date, selectedSpaceId);
  return (
    <main className="mx-auto max-w-7xl space-y-6 px-6 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <Link
            className="inline-flex min-h-11 items-center text-sm text-muted-foreground underline underline-offset-4"
            href="/branches"
          >
            {data.branch.name} · 지점 바꾸기
          </Link>
          <h1 className="text-2xl font-semibold">
            {data.floor.name} 공간 예약
          </h1>
        </div>
        <nav
          aria-label="날짜 선택"
          className="flex flex-wrap items-center gap-2 tabular-nums"
        >
          {data.date > today ? (
            <Button asChild variant="outline">
              <Link href={link(addDays(data.date, -1))}>이전 날</Link>
            </Button>
          ) : (
            <Button variant="outline" disabled>
              이전 날
            </Button>
          )}
          <span className="px-2">
            {formatBookingDate(data.date, data.branch.timezone)}
          </span>
          {data.date < addDays(today, 60) ? (
            <Button asChild variant="outline">
              <Link href={link(addDays(data.date, 1))}>다음 날</Link>
            </Button>
          ) : (
            <Button variant="outline" disabled>
              다음 날
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link href={link(today)}>오늘</Link>
          </Button>
        </nav>
      </header>
      <nav aria-label="층 선택" className="flex flex-wrap gap-2">
        {data.floors.map((floor) => (
          <Button
            key={floor.id}
            asChild
            variant={floor.id === data.floor.id ? "secondary" : "ghost"}
          >
            <Link
              href={floorHref(data.branch.id, floor.id, data.date)}
              aria-current={floor.id === data.floor.id ? "page" : undefined}
            >
              {floor.name}
            </Link>
          </Button>
        ))}
      </nav>
      {!data.openHours && (
        <p
          role="status"
          className="rounded-lg border border-border bg-muted p-4"
        >
          쉬는 날이에요. 다른 날짜를 골라 주세요
        </p>
      )}
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)]">
        <div className="space-y-5">
          {data.spaces.length === 0 && (
            <p className="py-8 text-muted-foreground">
              이 층에는 공간이 아직 없어요
            </p>
          )}
          {types.map((type) => {
            const rows = data.spaces.filter((space) => space.type === type);
            if (!rows.length) return null;
            return (
              <section key={type} className="space-y-3">
                <h2 className="font-semibold">{spaceTypeLabels[type]}</h2>
                <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                  {rows.map((space) => (
                    <li key={space.id}>
                      {space.kind === "restricted" ? (
                        <div className="p-5">
                          <StatusBadge status="restricted" />
                        </div>
                      ) : (
                        <Link
                          href={floorHref(
                            data.branch.id,
                            data.floor.id,
                            data.date,
                            space.id,
                          )}
                          aria-current={
                            selectedSpaceId === space.id ? "true" : undefined
                          }
                          className={`block min-h-11 space-y-2 p-5 focus-visible:outline-2 focus-visible:outline-ring ${selectedSpaceId === space.id ? "bg-accent" : "hover:bg-muted"}`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <h3 className="font-medium">{space.name}</h3>
                            {space.bookable && space.status && (
                              <StatusBadge status={space.status} />
                            )}
                          </div>
                          <p className="text-sm text-muted-foreground tabular-nums">
                            {space.capacity !== null &&
                              `최대 ${space.capacity}인`}
                            {space.amenities.length > 0 &&
                              ` · ${space.amenities.map((key) => amenityLabels[key as AmenityKey]).join(" · ")}`}
                          </p>
                          <p className="text-sm tabular-nums">
                            {space.bookable
                              ? `예약 ${space.bookingCount}건`
                              : space.deskCount > 0
                                ? `좌석 ${space.deskCount}석 · 좌석 예약은 준비 중이에요`
                                : "예약 없이 이용해요"}
                          </p>
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
        {children ?? (
          <section className="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">
            공간을 골라 하루 일정과 예약 시간을 확인해 주세요
          </section>
        )}
      </div>
    </main>
  );
}
