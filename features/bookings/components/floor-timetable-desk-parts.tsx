import { Button } from "@/components/ui/button";
import { deskPartLabels } from "@/features/bookings/desk-parts";
import { deskPartStatus } from "@/features/bookings/desk-part-status";
import { formatBookingTime } from "@/features/bookings/format";
import type { DeskPartSummary } from "@/features/bookings/types";
import type { TimetableFocus } from "@/features/bookings/timetable";
import { cn } from "@/lib/utils";
import type { TimetableFocusProps } from "./floor-timetable-row";
import type { TimetableDeskSelection } from "./floor-timetable";

export function FloorTimetableDeskParts({
  parts,
  spaceId,
  spaceName,
  timeZone,
  href,
  columns,
  windowStart,
  focusProps,
  onSelect,
}: {
  parts: readonly DeskPartSummary[];
  spaceId: string;
  spaceName: string;
  timeZone: string;
  href: string;
  columns: number;
  windowStart: number | null;
  focusProps: (position: TimetableFocus) => TimetableFocusProps;
  onSelect?: (input: TimetableDeskSelection) => void;
}) {
  if (windowStart === null) return null;
  return parts
    .filter((part) => part.part !== "day")
    .map((part) => {
      const offset = (Date.parse(part.start) - windowStart) / 1_800_000;
      const size = (Date.parse(part.end) - Date.parse(part.start)) / 1_800_000;
      const time = formatBookingTime(part.start, part.end, timeZone);
      const label = deskPartLabels[part.part];
      const status = deskPartStatus(part);
      return (
        <div
          key={part.part}
          role="gridcell"
          aria-colindex={Math.floor(offset) + 2}
          aria-colspan={Math.ceil(size)}
          data-desk-part={part.part}
          className="absolute inset-y-2 px-0.5"
          style={{
            left: `${(offset / columns) * 100}%`,
            width: `${(size / columns) * 100}%`,
          }}
        >
          {part.selectable ? (
            <Button
              {...focusProps({ spaceId, target: "slot", start: part.start })}
              type="button"
              variant="outline"
              data-space-id={spaceId}
              aria-label={`${spaceName}, ${label} ${time}, ${status}`}
              className={cn(
                "flex h-full min-h-11 w-full min-w-0 [scroll-margin-inline-start:var(--timetable-label-width)] items-center justify-between gap-2 rounded-md px-3 text-xs tabular-nums focus-visible:relative focus-visible:z-30",
                part.myDeskName
                  ? "border-primary bg-status-mine text-status-mine-foreground hover:bg-accent"
                  : part.freeCount > 0
                    ? "border-status-free-border bg-status-free text-status-free-foreground hover:bg-status-free"
                    : "bg-muted text-muted-foreground",
              )}
              onClick={(event) =>
                onSelect?.({
                  spaceId,
                  part: part.part,
                  href,
                  trigger: event.currentTarget,
                })
              }
            >
              <span className="truncate">
                {label} {time} · {status}
              </span>
              <span className="shrink-0">자리 고르기</span>
            </Button>
          ) : (
            <span className="flex h-full items-center rounded-md bg-muted/50 px-3 text-xs text-muted-foreground">
              {label} · 지난 시간
            </span>
          )}
        </div>
      );
    });
}
