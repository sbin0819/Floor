"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FloorDayData } from "@/features/bookings/types";
import {
  initialPlanTime,
  planTimeLabel,
  planTimeSlots,
  planTimeValueText,
} from "../time";

export function PlanTimeBar({
  data,
  at,
  onChange,
  summary,
}: {
  data: FloorDayData;
  at: number;
  onChange: (at: number) => void;
  summary: string;
}) {
  const slots = planTimeSlots(data);
  const index = Math.max(0, slots.indexOf(at));
  return (
    <div className="flex flex-wrap items-center gap-4 border-b border-border p-4">
      <div className="min-w-40">
        <h2 className="font-bold tabular-nums">
          {planTimeLabel(at, data.branch.timezone)} 기준
        </h2>
        <p
          className="text-xs text-muted-foreground tabular-nums"
          aria-live="polite"
        >
          {summary}
        </p>
      </div>
      <div className="flex min-w-56 flex-1 items-center gap-3">
        <Button
          variant="outline"
          size="icon"
          aria-label="이전 30분"
          disabled={index === 0}
          onClick={() => {
            const value = slots[index - 1];
            if (value !== undefined) onChange(value);
          }}
        >
          <ChevronLeft />
        </Button>
        <input
          type="range"
          aria-label="평면도 기준 시각"
          aria-valuetext={planTimeValueText(at, data.branch.timezone)}
          min={0}
          max={Math.max(0, slots.length - 1)}
          step={1}
          value={index}
          onChange={(event) => {
            const value = slots[Number(event.target.value)];
            if (value !== undefined) onChange(value);
          }}
          className="h-11 min-w-0 flex-1 accent-primary"
        />
        <Button
          variant="outline"
          size="icon"
          aria-label="다음 30분"
          disabled={index === slots.length - 1}
          onClick={() => {
            const value = slots[index + 1];
            if (value !== undefined) onChange(value);
          }}
        >
          <ChevronRight />
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            const now = initialPlanTime(data);
            if (now !== null) onChange(now);
          }}
        >
          지금
        </Button>
      </div>
    </div>
  );
}
