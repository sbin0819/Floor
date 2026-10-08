"use client";

import { useState, type RefObject } from "react";
import { ParticipantInput } from "@/components/participant-input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { BookingParticipantDraft } from "@/features/bookings/participants";
import type { BookingFormVariant } from "./booking-form-fields";

export function BookingParticipantsField({
  variant,
  error,
  inputRef,
  ...props
}: {
  variant: BookingFormVariant;
  id: string;
  value: readonly BookingParticipantDraft[];
  onChange: (value: BookingParticipantDraft[]) => void;
  maxParticipants: number;
  disabled: boolean;
  error?: string;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [previousError, setPreviousError] = useState(error);
  if (previousError !== error) {
    setPreviousError(error);
    if (error) setOpen(true);
  }
  const input = (
    <ParticipantInput {...props} error={error} inputRef={inputRef} />
  );
  if (variant === "panel") return input;
  const label = props.value.length
    ? `참석자 ${props.value.length}명`
    : "참석자 없음";
  return (
    <div className="min-w-32">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            disabled={props.disabled}
            aria-label={`${label}, 고치기`}
            aria-invalid={Boolean(error)}
          >
            {label}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          className="w-96 max-w-[calc(100vw-2rem)]"
          align="start"
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          {input}
        </PopoverContent>
      </Popover>
    </div>
  );
}
