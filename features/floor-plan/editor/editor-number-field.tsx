"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NumberField({
  label,
  value,
  onCommit,
  disabled = false,
  min,
  max,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
}) {
  const id = useId();
  const [draft, setDraft] = useState({ source: value, text: String(value) });
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        className="tabular-nums"
        type="number"
        step={1}
        min={min}
        max={max}
        disabled={disabled}
        value={draft.source === value ? draft.text : String(value)}
        onChange={(event) =>
          setDraft({ source: value, text: event.target.value })
        }
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        onBlur={(event) => {
          const next = Number(event.target.value);
          if (
            event.target.value.trim() &&
            Number.isSafeInteger(next) &&
            next !== value
          )
            onCommit(next);
          setDraft({ source: value, text: String(value) });
        }}
      />
    </div>
  );
}
