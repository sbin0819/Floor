"use client";

import { useId, type Ref } from "react";
import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { attendeeCountError } from "@/features/bookings/attendee-count";

export function AttendeeCountInput({
  id: suppliedId,
  value,
  capacity,
  minimum = 1,
  disabled = false,
  error,
  inputRef,
  className,
  onChange,
}: {
  id?: string;
  value: number | null;
  capacity: number | null;
  minimum?: number;
  disabled?: boolean;
  error?: string;
  inputRef?: Ref<HTMLInputElement>;
  className?: string;
  onChange: (value: number | null) => void;
}) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const maximum = Math.min(capacity ?? 500, 500);
  const message = error ?? attendeeCountError(value, capacity, minimum);
  const canIncrease = (value ?? minimum - 1) < maximum;
  const describedBy = [
    capacity !== null ? `${id}-capacity` : null,
    message ? `${id}-error` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cn("space-y-1", className)}>
      <Label htmlFor={id}>사용 인원 (선택)</Label>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <div className="flex w-36 items-center rounded-lg border border-input">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="한 명 줄이기"
            disabled={disabled}
            aria-disabled={value === null || undefined}
            onClick={() => {
              if (value !== null) onChange(value <= minimum ? null : value - 1);
            }}
          >
            <Minus aria-hidden="true" />
          </Button>
          <Input
            ref={inputRef}
            id={id}
            type="number"
            inputMode="numeric"
            min={minimum}
            max={maximum}
            step={1}
            placeholder="미정"
            value={value ?? ""}
            disabled={disabled}
            aria-invalid={Boolean(message)}
            aria-describedby={describedBy || undefined}
            className="h-11 [appearance:textfield] rounded-none border-0 px-0 text-center tabular-nums [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            onChange={(event) => {
              const raw = event.target.value;
              const next = raw === "" ? null : Number(raw);
              if (next === null || Number.isFinite(next)) onChange(next);
            }}
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            aria-label="한 명 늘리기"
            disabled={disabled}
            aria-disabled={!canIncrease || undefined}
            onClick={() => {
              if (canIncrease) onChange(value === null ? minimum : value + 1);
            }}
          >
            <Plus aria-hidden="true" />
          </Button>
        </div>
        {capacity !== null && (
          <span
            id={`${id}-capacity`}
            className="text-xs text-muted-foreground tabular-nums"
          >
            정원 {capacity}명
          </span>
        )}
      </div>
      {message && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {message}
        </p>
      )}
    </div>
  );
}
