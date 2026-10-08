"use client";

import type { FormEventHandler, ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import type { BookingFormVariant } from "./booking-form-fields";

export function BookingFormLayout({
  id,
  variant,
  bookable,
  deskCount,
  selected,
  expanded,
  disabled,
  hasActor,
  overLimit,
  message,
  timeline,
  summary,
  times,
  attendeeInput,
  titleInput,
  actorInput,
  submitButton,
  limit,
  onToggle,
  onSubmit,
}: {
  id: string;
  variant: BookingFormVariant;
  bookable: boolean;
  deskCount: number;
  selected: boolean;
  expanded: boolean;
  disabled: boolean;
  hasActor: boolean;
  overLimit: boolean;
  message: string;
  timeline: ReactNode;
  summary: ReactNode;
  times: ReactNode;
  attendeeInput: ReactNode;
  titleInput: ReactNode;
  actorInput: ReactNode;
  submitButton: ReactNode;
  limit: ReactNode;
  onToggle: () => void;
  onSubmit: FormEventHandler<HTMLFormElement>;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {variant === "panel" && (
        <div
          data-booking-scroll="true"
          className="min-h-[280px] flex-1 overflow-y-auto overscroll-contain p-3"
        >
          {timeline}
        </div>
      )}
      <form
        aria-label="예약 양식"
        data-booking-variant={variant}
        className={cn(
          "shrink-0 bg-card",
          variant === "panel"
            ? "space-y-1 border-t border-border p-3"
            : "grid min-w-0 grid-cols-2 items-end gap-3 lg:flex lg:flex-wrap",
        )}
        onSubmit={onSubmit}
      >
        {!bookable ? (
          <p>
            예약 없이 이용해요
            {deskCount > 0 && (
              <span className="block tabular-nums">
                좌석 {deskCount}석 · 좌석 예약은 준비 중이에요
              </span>
            )}
          </p>
        ) : (
          <>
            {variant === "panel" ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-x-2">
                  {summary}
                  {selected && (
                    <Button
                      type="button"
                      variant="ghost"
                      className="px-1 text-xs text-primary"
                      disabled={disabled}
                      aria-expanded={expanded}
                      aria-controls={`${id}-details`}
                      onClick={onToggle}
                    >
                      예약 내용 바꾸기
                      <ChevronDown
                        aria-hidden="true"
                        className={cn("size-3", expanded && "rotate-180")}
                      />
                    </Button>
                  )}
                </div>
                {selected && (
                  <>
                    <div
                      id={`${id}-details`}
                      hidden={!expanded}
                      className="space-y-2 pb-2"
                    >
                      {times}
                      {attendeeInput}
                      {titleInput}
                    </div>
                    <div className="flex items-center gap-2">
                      {actorInput}
                      {submitButton}
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                {!selected && (
                  <div className="col-span-2 basis-full">{summary}</div>
                )}
                {times}
                {actorInput}
                {attendeeInput}
                {titleInput}
                {submitButton}
              </>
            )}
            {limit}
            {overLimit && (
              <p
                aria-live="polite"
                className={cn(
                  "text-xs text-muted-foreground",
                  variant === "strip" && "order-last col-span-2 basis-full",
                )}
              >
                선택한 시간이 예약 한도를 넘어요. 시간을 줄이거나 예약할 때
                확인해 주세요
              </p>
            )}
            {!hasActor && <p>이 공간을 예약할 권한이 없어요</p>}
          </>
        )}
        <p
          role="status"
          aria-live="polite"
          className={cn(
            "text-sm text-destructive empty:hidden",
            variant === "strip" && "order-last col-span-2 basis-full",
          )}
        >
          {message}
        </p>
      </form>
    </div>
  );
}
