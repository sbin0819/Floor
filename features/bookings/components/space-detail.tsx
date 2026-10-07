import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { floorHref } from "@/features/bookings/format";
import { amenityLabels, type AmenityKey } from "@/lib/spaces/amenities";
import type { SpaceDayData } from "@/features/bookings/types";
import { BookingForm } from "./booking-form";
import { FloorNavigationLink } from "./floor-navigation-link";

export function SpaceDetail({ data }: { data: SpaceDayData }) {
  return (
    <section
      aria-label="공간 상세"
      className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card"
    >
      <header className="shrink-0 space-y-2 border-b border-border p-4">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-xl font-semibold">{data.space.name}</h2>
          <Button asChild variant="ghost" size="icon">
            <FloorNavigationLink
              href={floorHref(data.branch.id, data.floor.id, data.date)}
              location={{
                floorId: data.floor.id,
                date: data.date,
                spaceId: null,
              }}
              replace
              aria-label="공간 상세 닫기"
            >
              <X aria-hidden="true" />
            </FloorNavigationLink>
          </Button>
        </div>
        <p className="text-muted-foreground tabular-nums">
          {data.floor.level}층
          {data.space.capacity !== null && ` · 최대 ${data.space.capacity}인`}
        </p>
        <div className="flex flex-wrap gap-2">
          {data.space.status && <StatusBadge status={data.space.status} />}
          {data.space.amenities.map((key) => (
            <Badge key={key} variant="secondary">
              {amenityLabels[key as AmenityKey]}
            </Badge>
          ))}
        </div>
      </header>
      <BookingForm key={`${data.space.id}:${data.date}`} data={data} />
    </section>
  );
}
