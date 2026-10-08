import { Badge } from "@/components/ui/badge";
import { deskPartLabels } from "@/features/bookings/desk-parts";
import { deskPartStatus } from "@/features/bookings/desk-part-status";
import type { DeskPartSummary } from "@/features/bookings/types";
import { cn } from "@/lib/utils";

export function DeskPartBadges({
  parts,
}: {
  parts: readonly DeskPartSummary[];
}) {
  return (
    <span className="flex flex-wrap gap-2">
      {parts.map((part) => (
        <Badge
          key={part.part}
          variant="secondary"
          className={cn(
            "tabular-nums",
            part.selectable &&
              (part.myDeskName
                ? "bg-status-mine text-status-mine-foreground"
                : part.freeCount > 0 &&
                  "bg-status-free text-status-free-foreground"),
          )}
        >
          {deskPartLabels[part.part]}{" "}
          {part.selectable ? deskPartStatus(part) : "지남"}
        </Badge>
      ))}
    </span>
  );
}
