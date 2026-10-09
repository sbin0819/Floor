"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { seatLabelSchema } from "@/lib/floor-plan/schema";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import type { Command } from "./commands";
import { setSeatCommand } from "./seat-commands";

function SeatField({
  label,
  value,
  disabled,
  onCommit,
  numeric = false,
}: {
  label: string;
  value: string;
  disabled: boolean;
  numeric?: boolean;
  onCommit: (value: string) => string | null;
}) {
  const id = useId();
  const [draft, setDraft] = useState({ source: value, text: value });
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={numeric ? "number" : "text"}
        className={numeric ? "tabular-nums" : undefined}
        disabled={disabled}
        value={draft.source === value ? draft.text : value}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? `${id}-error` : undefined}
        onChange={(event) => {
          setDraft({ source: value, text: event.target.value });
          setError(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        onBlur={(event) => {
          if (disabled) return;
          const message = onCommit(event.target.value);
          setError(message);
          if (!message) setDraft({ source: value, text: value });
        }}
      />
      {error && (
        <p id={`${id}-error`} className="text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function SeatProperties({
  document,
  seatId,
  displayName,
  bookingCount = 0,
  disabled = false,
  onCommand,
}: {
  document: FloorPlanDocument;
  seatId: string;
  displayName: string | null;
  bookingCount?: number;
  disabled?: boolean;
  onCommand: (command: Command) => void;
}) {
  const seat = document.seats.find(({ id }) => id === seatId);
  if (!seat) return null;
  const commit = (patch: Parameters<typeof setSeatCommand>[2]) => {
    if (disabled) return;
    const command = setSeatCommand(document, seatId, patch);
    if (command) onCommand(command);
  };
  return (
    <section className="space-y-5 p-5 text-sm" aria-label="좌석 속성">
      <h2 className="text-base font-bold">좌석</h2>
      <SeatField
        key={`${seatId}-label`}
        label="좌석 이름"
        value={seat.label ?? displayName ?? ""}
        disabled={disabled}
        onCommit={(value) => {
          if (value.trim() && !seatLabelSchema.safeParse(value).success)
            return "좌석 이름을 20자 이내로 입력해 주세요";
          commit({ label: value });
          return null;
        }}
      />
      <div className="grid grid-cols-2 gap-3">
        {(["너비", "깊이"] as const).map((label, index) => (
          <SeatField
            key={`${seatId}-${label}`}
            label={`${label} (mm)`}
            value={String(seat.size[index])}
            disabled={disabled}
            numeric
            onCommit={(value) => {
              const number = Number(value);
              if (
                !value.trim() ||
                !Number.isInteger(number) ||
                number < 400 ||
                number > 3000
              )
                return "400–3,000mm로 입력해 주세요";
              const size: [number, number] = [...seat.size];
              size[index] = number;
              commit({ size });
              return null;
            }}
          />
        ))}
      </div>
      <fieldset disabled={disabled}>
        <legend className="mb-2 font-medium">좌석 방향</legend>
        <div className="grid grid-cols-4 gap-1">
          {([0, 90, 180, 270] as const).map((rotation) => (
            <Button
              key={rotation}
              type="button"
              variant={seat.rotation === rotation ? "default" : "outline"}
              aria-pressed={seat.rotation === rotation}
              onClick={() => commit({ rotation })}
              className="tabular-nums"
            >
              {rotation}°
            </Button>
          ))}
        </div>
      </fieldset>
      {bookingCount > 0 && (
        <p className="text-status-busy-strong tabular-nums">
          예약 {bookingCount}건이 남아 있어요. 이 좌석을 지우면 게시할 수
          없어요.
        </p>
      )}
    </section>
  );
}
