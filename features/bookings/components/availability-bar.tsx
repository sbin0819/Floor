import { cn } from "cn";
import {
  availabilityCurrentPosition,
  availabilityLabel,
  availabilityTicks,
  intervalPosition,
  type AvailabilityInterval,
} from "@/features/bookings/availability";
import type { OperatingWindow } from "@/features/bookings/operating-state";

const intervalStyles = {
  other: "z-0 bg-booked-strong",
  mine: "z-10 bg-status-mine-strong",
  maintenance: "z-20 bg-status-maintenance-hatch",
};

export function AvailabilityBar({
  intervals,
  window,
  timeZone,
  now,
  showTicks = true,
  className,
}: {
  intervals: readonly AvailabilityInterval[];
  window: OperatingWindow | null;
  timeZone: string;
  now?: string;
  showTicks?: boolean;
  className?: string;
}) {
  if (!window) return null;
  const current = now ? availabilityCurrentPosition(now, window) : null;
  return (
    <div className={cn("min-w-0 space-y-1", className)}>
      <div
        role="img"
        aria-label={availabilityLabel(intervals, timeZone)}
        className="relative isolate h-3 overflow-hidden rounded-full bg-status-free"
      >
        {intervals.map((interval) => {
          const position = intervalPosition(interval, window);
          return (
            position && (
              <span
                key={`${interval.kind}:${interval.start}:${interval.end}`}
                aria-hidden="true"
                data-kind={interval.kind}
                className={cn(
                  "absolute inset-y-0",
                  intervalStyles[interval.kind],
                )}
                style={{
                  left: `${position.left}%`,
                  width: `${position.width}%`,
                }}
              />
            )
          );
        })}
        {current && current.pastWidth > 0 && (
          <span
            aria-hidden="true"
            data-slot="availability-past"
            className="absolute inset-y-0 left-0 z-30 bg-background/55"
            style={{ width: `${current.pastWidth}%` }}
          />
        )}
        {current?.line !== null && current?.line !== undefined && (
          <span
            aria-hidden="true"
            data-slot="availability-now"
            className="absolute inset-y-0 z-40 w-0.5 bg-status-busy-strong"
            style={{ left: `${current.line}%` }}
          />
        )}
      </div>
      {showTicks && (
        <div
          aria-hidden="true"
          data-slot="availability-ticks"
          className="relative h-4 text-[11px] text-muted-foreground tabular-nums"
        >
          {availabilityTicks(window, timeZone).map((tick) => (
            <span
              key={tick.value}
              className={cn(
                "absolute",
                tick.position === 0
                  ? "left-0"
                  : tick.position === 100
                    ? "right-0"
                    : "-translate-x-1/2",
              )}
              style={
                tick.position > 0 && tick.position < 100
                  ? { left: `${tick.position}%` }
                  : undefined
              }
            >
              {tick.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
