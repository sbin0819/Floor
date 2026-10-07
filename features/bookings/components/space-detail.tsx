import { StatusBadge } from "@/components/status-badge";
import { Badge } from "@/components/ui/badge";
import { amenityLabels, type AmenityKey } from "@/lib/spaces/amenities";
import type { SpaceDayData } from "@/features/bookings/types";
import { BookingForm } from "./booking-form";

export function SpaceDetail({ data }: { data: SpaceDayData }) {
  return (
    <section
      aria-label="공간 상세"
      className="space-y-6 rounded-xl border border-border bg-card p-5"
    >
      <header className="space-y-3">
        <h2 className="text-xl font-semibold">{data.space.name}</h2>
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
