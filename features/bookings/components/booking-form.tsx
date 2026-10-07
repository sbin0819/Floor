"use client";

import { useId, useMemo, useState } from "react";
import { ChevronDown, LoaderCircle } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createBooking } from "@/features/bookings/actions";
import {
  selectableEnds,
  selectableSlots,
  selectBookingSlot,
  suggestedEnd,
} from "@/features/bookings/selection";
import type { SpaceDayData } from "@/features/bookings/types";
import { formatBookingTime } from "@/features/bookings/format";
import { localDate } from "@/lib/time/zoned";
import { BookingTimeline } from "./booking-timeline";
import { CancelBookingButton } from "./cancel-booking-button";
import { useBookingMutation } from "./use-booking-mutation";
import { useFloorSelection } from "./branch-workspace";

function TimeSelect({
  id,
  label,
  value,
  disabled,
  onChange,
  options,
  error,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
  error?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value}
        onValueChange={(next) => {
          // 종료 옵션이 새로 생길 때 네이티브 폼 동기화가 보내는 빈 값은 선택이 아니다.
          if (options.some((option) => option.value === next)) onChange(next);
        }}
        disabled={disabled}
      >
        <SelectTrigger
          id={id}
          className="min-h-11 w-full tabular-nums"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        >
          <SelectValue placeholder={`${label} 시각 선택`}>
            {options.find((option) => option.value === value)?.label}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem
              className="min-h-11 tabular-nums"
              key={option.value}
              value={option.value}
            >
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export function BookingForm({
  data,
  variant = "panel",
  onBooked,
}: {
  data: SpaceDayData;
  variant?: "panel" | "strip";
  onBooked?: () => void;
}) {
  const id = useId();
  const workspace = useFloorSelection();
  const [localRange, setLocalRange] = useState<{
    start: string;
    end: string;
  } | null>(null);
  const range = workspace
    ? workspace.selection?.spaceId === data.space.id
      ? workspace.selection
      : null
    : localRange;
  const start = range?.start ?? "";
  const end = range?.end ?? "";
  const setRange = (next: { start: string; end: string } | null) => {
    if (workspace) workspace.changeRange(data.space.id, next);
    else setLocalRange(next);
  };
  const [title, setTitle] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [actorId, setActorId] = useState(data.actors[0]?.teamId ?? "personal");
  const slots = useMemo(() => selectableSlots(data), [data]);
  const selectedStart = slots.some(
    (slot) => slot.start === start && slot.state === "free",
  )
    ? start
    : "";
  const ends = selectableEnds(slots, selectedStart);
  const selectedEnd = ends.some((slot) => slot.end === end) ? end : "";
  const selected = Boolean(selectedStart && selectedEnd);
  const actor =
    data.actors.find(({ teamId }) => (teamId ?? "personal") === actorId) ??
    data.actors[0];
  const isToday =
    data.date === localDate(new Date(data.now), data.branch.timezone);
  const mutation = useBookingMutation({
    action: createBooking,
    successMessage: "예약했어요",
    errorOptions: {
      limits: actor?.limits,
      isToday,
      restricted: !data.actors.some(({ teamId }) => teamId === null),
    },
    onSuccess: () => {
      setRange(null);
      setTitle("");
      setExpanded(false);
      onBooked?.();
    },
  });
  const [previousErrors, setPreviousErrors] = useState(mutation.fieldErrors);
  if (previousErrors !== mutation.fieldErrors) {
    setPreviousErrors(mutation.fieldErrors);
    if (
      ["start", "end", "title"].some((key) => mutation.fieldErrors[key]?.length)
    )
      setExpanded(true);
  }
  const disabled =
    mutation.pending || !data.openHours || !data.space.bookable || !actor;
  const duration = selected
    ? (Date.parse(selectedEnd) - Date.parse(selectedStart)) / 60_000
    : 0;
  const overLimit =
    actor &&
    duration > 0 &&
    ((actor.limits.maxMinutesPerBooking !== null &&
      duration > actor.limits.maxMinutesPerBooking) ||
      (actor.remainingMinutes !== null && duration > actor.remainingMinutes));
  const summaryDate = isToday
    ? "오늘"
    : selectedStart
      ? new Intl.DateTimeFormat("ko-KR", {
          timeZone: data.branch.timezone,
          month: "long",
          day: "numeric",
          weekday: "short",
        })
          .format(new Date(selectedStart))
          .replace(/[()]/g, "")
      : "";
  const summary = (
    <p
      aria-live="polite"
      aria-atomic="true"
      className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold tabular-nums"
    >
      {selected ? (
        <>
          <span>
            {summaryDate} ·{" "}
            {formatBookingTime(
              selectedStart,
              selectedEnd,
              data.branch.timezone,
            )}
          </span>
          <span className="font-normal text-muted-foreground">
            {duration >= 60 ? `${Math.floor(duration / 60)}시간` : ""}
            {duration % 60 ? ` ${duration % 60}분` : ""}
          </span>
        </>
      ) : (
        "시간을 골라 주세요"
      )}
    </p>
  );
  const times = (
    <div
      className={cn(
        "grid grid-cols-2 gap-3",
        variant === "strip" && "col-span-2 min-w-56 lg:flex-1",
      )}
    >
      <TimeSelect
        id={`${id}-start`}
        label="시작"
        value={selectedStart}
        disabled={disabled}
        onChange={(value) =>
          setRange({ start: value, end: suggestedEnd(slots, value) })
        }
        options={slots
          .filter((slot) => slot.state === "free")
          .map((slot) => ({ value: slot.start, label: slot.label }))}
        error={mutation.fieldErrors.start?.[0]}
      />
      <TimeSelect
        id={`${id}-end`}
        label="끝"
        value={selectedEnd}
        disabled={disabled || !selectedStart}
        onChange={(value) => setRange({ start, end: value })}
        options={ends.map((slot) => ({
          value: slot.end,
          label: slot.endLabel,
        }))}
        error={mutation.fieldErrors.end?.[0]}
      />
    </div>
  );
  const titleInput = (
    <div className={cn("space-y-1", variant === "strip" && "min-w-32 flex-1")}>
      <Label htmlFor={`${id}-title`}>제목 (선택)</Label>
      <Input
        id={`${id}-title`}
        value={title}
        maxLength={60}
        disabled={disabled}
        aria-invalid={Boolean(mutation.fieldErrors.title)}
        aria-describedby={
          mutation.fieldErrors.title ? `${id}-title-error` : undefined
        }
        onChange={(event) => setTitle(event.target.value)}
      />
      {mutation.fieldErrors.title && (
        <p id={`${id}-title-error`} className="text-xs text-destructive">
          {mutation.fieldErrors.title[0]}
        </p>
      )}
    </div>
  );
  const actorInput = data.hasTeams && (
    <div
      className={cn(
        variant === "strip" ? "min-w-32 space-y-1" : "min-w-0 flex-1",
      )}
    >
      <Label
        htmlFor={`${id}-actor`}
        className={variant === "panel" ? "sr-only" : undefined}
      >
        예약 방식
      </Label>
      <Select
        value={actor?.teamId ?? "personal"}
        onValueChange={setActorId}
        disabled={disabled}
      >
        <SelectTrigger id={`${id}-actor`} className="min-h-11 w-full">
          <SelectValue placeholder="예약 방식 선택">{actor?.name}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {data.actors.map((item) => (
            <SelectItem
              className="min-h-11"
              key={item.teamId ?? "personal"}
              value={item.teamId ?? "personal"}
            >
              {item.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
  const submitButton = (
    <Button
      type="submit"
      className={
        variant === "panel" ? "min-w-0 flex-1" : "col-span-2 lg:w-auto"
      }
      disabled={disabled || !selected}
    >
      {mutation.pending && (
        <LoaderCircle
          aria-hidden="true"
          className="animate-spin motion-reduce:animate-none"
        />
      )}
      {mutation.pending ? "예약하고 있어요" : "예약하기"}
    </Button>
  );
  const limit = actor && (
    <p
      className={cn(
        "text-xs text-muted-foreground tabular-nums",
        variant === "strip" && "order-last col-span-2 basis-full",
      )}
    >
      {actor.teamId === null ? "개인" : "팀"} 예약은{" "}
      {actor.limits.maxMinutesPerDay === null
        ? "하루 한도가 없어요"
        : `하루 ${actor.limits.maxMinutesPerDay / 60}시간까지`}
      {actor.remainingMinutes !== null &&
        ` · ${isToday ? "오늘" : "이 날"} ${actor.remainingMinutes / 60}시간 남음`}
    </p>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {variant === "panel" && (
        <div
          data-booking-scroll="true"
          className="min-h-[280px] flex-1 overflow-y-auto overscroll-contain p-3"
        >
          <BookingTimeline
            slots={slots}
            bookings={data.bookings}
            blocks={data.blocks}
            timeZone={data.branch.timezone}
            now={data.now}
            date={data.date}
            start={selectedStart}
            end={selectedEnd}
            disabled={disabled}
            renderCancel={(bookingId) => (
              <CancelBookingButton bookingId={bookingId} />
            )}
            onSelect={(value) => {
              const selection = selectBookingSlot(
                slots,
                selected ? { start: selectedStart, end: selectedEnd } : null,
                value,
              );
              if (selection) setRange(selection);
            }}
          />
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
        onSubmit={(event) => {
          event.preventDefault();
          if (!actor || !selectedStart || !selectedEnd || disabled) return;
          void mutation.submit({
            spaceId: data.space.id,
            start: selectedStart,
            end: selectedEnd,
            teamId: actor.teamId,
            title,
          });
        }}
      >
        {!data.space.bookable ? (
          <p>
            예약 없이 이용해요
            {data.space.deskCount > 0 && (
              <span className="block tabular-nums">
                좌석 {data.space.deskCount}석 · 좌석 예약은 준비 중이에요
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
                      onClick={() => setExpanded((value) => !value)}
                    >
                      시간·제목 바꾸기
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
            {!actor && <p>이 공간을 예약할 권한이 없어요</p>}
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
          {mutation.message}
        </p>
      </form>
    </div>
  );
}
