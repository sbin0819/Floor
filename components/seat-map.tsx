"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SeatMapState =
  "free" | "booked" | "mine" | "blocked" | "unavailable";
export type SeatMapItem = {
  id: string;
  name: string;
  row: number;
  column: number;
  state: SeatMapState;
};
const labels: Record<SeatMapState, string> = {
  free: "비어 있음",
  booked: "예약됨",
  mine: "내 자리",
  blocked: "점검",
  unavailable: "예약할 수 없는 자리",
};
const colors: Record<SeatMapState, string> = {
  free: "border-status-free-border bg-status-free text-status-free-foreground hover:bg-status-free",
  booked:
    "border-booked-border bg-booked text-muted-foreground hover:bg-booked",
  mine: "border-status-mine-border bg-status-mine text-status-mine-foreground hover:bg-status-mine",
  blocked: "border-input bg-status-maintenance-hatch text-muted-foreground",
  unavailable: "border-input bg-status-maintenance-hatch text-muted-foreground",
};

export function SeatMap({
  seats,
  selectedId,
  disabled = false,
  onSelect,
}: {
  seats: readonly SeatMapItem[];
  selectedId: string | null;
  disabled?: boolean;
  onSelect: (id: string | null) => void;
}) {
  const [focused, setFocused] = useState<string | null>(null);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const groups = new Map<number, SeatMapItem[]>();
  for (const seat of seats) {
    const row = groups.get(seat.row) ?? [];
    row.push(seat);
    groups.set(seat.row, row);
  }
  const rows = [...groups]
    .sort(([a], [b]) => a - b)
    .map(([, row]) => row.sort((a, b) => a.column - b.column));
  const all = rows.flat();
  const columns = Math.max(1, ...rows.map((row) => row.length));
  const tabStop =
    all.find((seat) => seat.id === focused)?.id ??
    all.find((seat) => seat.id === selectedId)?.id ??
    all[0]?.id;
  const freeCount = seats.filter((seat) => seat.state === "free").length;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">자리 고르기</h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          빈 자리 {freeCount} / {seats.length}
        </span>
      </div>
      <div
        role="group"
        aria-label="좌석 배치도"
        className="min-h-0 flex-1 overflow-auto overscroll-contain p-1"
      >
        <div
          className="space-y-2"
          style={{ minWidth: columns * 44 + (columns - 1) * 8 }}
        >
          {rows.map((row, rowIndex) => (
            <div
              key={row[0]!.row}
              className="grid gap-2"
              style={{
                gridTemplateColumns: `repeat(${columns}, minmax(44px, 1fr))`,
              }}
            >
              {row.map((seat, columnIndex) => {
                const blocked =
                  disabled || (seat.state !== "free" && seat.state !== "mine");
                return (
                  <Button
                    key={seat.id}
                    ref={(node) => {
                      if (node) refs.current.set(seat.id, node);
                      else refs.current.delete(seat.id);
                    }}
                    type="button"
                    variant="outline"
                    className={cn(
                      "h-11 min-w-11 px-1 text-xs tabular-nums",
                      colors[seat.state],
                      selectedId === seat.id &&
                        "border-primary bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground",
                    )}
                    aria-label={`${seat.name}, ${labels[seat.state]}`}
                    aria-pressed={selectedId === seat.id}
                    aria-disabled={blocked || undefined}
                    tabIndex={seat.id === tabStop ? 0 : -1}
                    onFocus={() => setFocused(seat.id)}
                    onClick={() => {
                      if (!blocked)
                        onSelect(selectedId === seat.id ? null : seat.id);
                    }}
                    onKeyDown={(event) => {
                      let target: SeatMapItem | undefined;
                      switch (event.key) {
                        case "ArrowLeft":
                          target = row[Math.max(0, columnIndex - 1)];
                          break;
                        case "ArrowRight":
                          target =
                            row[Math.min(row.length - 1, columnIndex + 1)];
                          break;
                        case "Home":
                          target = row[0];
                          break;
                        case "End":
                          target = row.at(-1);
                          break;
                        case "ArrowUp":
                        case "ArrowDown": {
                          const nextRow =
                            rows[
                              Math.max(
                                0,
                                Math.min(
                                  rows.length - 1,
                                  rowIndex +
                                    (event.key === "ArrowDown" ? 1 : -1),
                                ),
                              )
                            ]!;
                          target =
                            nextRow[Math.min(columnIndex, nextRow.length - 1)];
                          break;
                        }
                        default:
                          return;
                      }
                      event.preventDefault();
                      if (target) refs.current.get(target.id)?.focus();
                    }}
                  >
                    {seat.name}
                  </Button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
      <div
        aria-label="좌석 상태 범례"
        className="flex shrink-0 flex-wrap justify-center gap-x-3 gap-y-1 text-xs text-muted-foreground"
      >
        {[
          { label: "빈 자리", className: colors.free },
          { label: "고른 자리", className: "border-primary bg-primary" },
          { label: "예약됨", className: colors.booked },
          { label: "점검", className: colors.blocked },
          ...(seats.some((seat) => seat.state === "mine")
            ? [{ label: "내 자리", className: colors.mine }]
            : []),
        ].map((item) => (
          <span key={item.label} className="inline-flex items-center gap-1">
            <span
              aria-hidden="true"
              className={cn("size-3 rounded border", item.className)}
            />
            {item.label}
          </span>
        ))}
      </div>
    </div>
  );
}
