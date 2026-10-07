"use client";

import { useId, useMemo, useState } from "react";
import { LoaderCircle, Plus } from "lucide-react";
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

function TimeSelect({
  id,
  label,
  value,
  disabled,
  onChange,
  options,
}: {
  id: string;
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value}
        onValueChange={(next) => {
          // 종료 옵션이 새로 생길 때 네이티브 폼 동기화가 보내는 빈 값은 선택이 아니다.
          if (options.some((option) => option.value === next)) onChange(next);
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="min-h-11 w-full tabular-nums">
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
    </div>
  );
}

export function BookingForm({ data }: { data: SpaceDayData }) {
  const id = useId();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [title, setTitle] = useState("");
  const [showTitle, setShowTitle] = useState(false);
  const [actorId, setActorId] = useState(data.actors[0]?.teamId ?? "personal");
  const slots = useMemo(() => selectableSlots(data), [data]);
  const selectedStart = slots.some(
    (slot) => slot.start === start && slot.state === "free",
  )
    ? start
    : "";
  const ends = selectableEnds(slots, selectedStart);
  const selectedEnd = ends.some((slot) => slot.end === end) ? end : "";
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
      setStart("");
      setEnd("");
      setTitle("");
    },
  });
  const disabled =
    mutation.pending || !data.openHours || !data.space.bookable || !actor;
  const selectStart = (value: string) => {
    setStart(value);
    setEnd(suggestedEnd(slots, value));
  };
  const duration =
    selectedStart && selectedEnd
      ? (Date.parse(selectedEnd) - Date.parse(selectedStart)) / 60_000
      : 0;
  const overLimit =
    actor &&
    duration > 0 &&
    ((actor.limits.maxMinutesPerBooking !== null &&
      duration > actor.limits.maxMinutesPerBooking) ||
      (actor.remainingMinutes !== null && duration > actor.remainingMinutes));
  const summaryDate = selectedStart
    ? new Intl.DateTimeFormat("ko-KR", {
        timeZone: data.branch.timezone,
        month: "long",
        day: "numeric",
        weekday: "short",
      })
        .format(new Date(selectedStart))
        .replace(/[()]/g, "")
    : "";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        data-booking-scroll="true"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
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
              selectedStart && selectedEnd
                ? { start: selectedStart, end: selectedEnd }
                : null,
              value,
            );
            if (selection) {
              setStart(selection.start);
              setEnd(selection.end);
            }
          }}
        />
      </div>
      <form
        aria-label="예약 양식"
        className="shrink-0 space-y-2 border-t border-border bg-card p-4"
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
        {!data.openHours && <p>쉬는 날이에요. 다른 날짜를 골라 주세요</p>}
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
            <p
              aria-live="polite"
              aria-atomic="true"
              className="flex flex-wrap items-center justify-between gap-1 text-sm font-semibold tabular-nums"
            >
              {selectedStart && selectedEnd ? (
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
            <div className="grid grid-cols-2 gap-3">
              <TimeSelect
                id={`${id}-start`}
                label="시작"
                value={selectedStart}
                disabled={disabled}
                onChange={selectStart}
                options={slots
                  .filter((slot) => slot.state === "free")
                  .map((slot) => ({ value: slot.start, label: slot.label }))}
              />
              <TimeSelect
                id={`${id}-end`}
                label="끝"
                value={selectedEnd}
                disabled={disabled || !selectedStart}
                onChange={setEnd}
                options={ends.map((slot) => ({
                  value: slot.end,
                  label: slot.endLabel,
                }))}
              />
            </div>
            {data.hasTeams && (
              <div className="space-y-2">
                <Label htmlFor={`${id}-actor`}>예약 방식</Label>
                <Select
                  value={actor?.teamId ?? "personal"}
                  onValueChange={setActorId}
                  disabled={disabled}
                >
                  <SelectTrigger id={`${id}-actor`} className="min-h-11 w-full">
                    <SelectValue placeholder="예약 방식 선택">
                      {actor?.name}
                    </SelectValue>
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
            )}
            {actor && (
              <p className="text-xs text-muted-foreground tabular-nums">
                {actor.teamId === null ? "개인" : "팀"} 예약은{" "}
                {actor.limits.maxMinutesPerDay === null
                  ? "하루 한도가 없어요"
                  : `하루 ${actor.limits.maxMinutesPerDay / 60}시간까지`}
                {actor.remainingMinutes !== null &&
                  ` · ${isToday ? "오늘" : "이 날"} ${actor.remainingMinutes / 60}시간 남음`}
              </p>
            )}
            {overLimit && (
              <p aria-live="polite" className="text-xs text-muted-foreground">
                선택한 시간이 예약 한도를 넘어요. 시간을 줄이거나 예약할 때
                확인해 주세요
              </p>
            )}
            {!actor && <p>이 공간을 예약할 권한이 없어요</p>}
            <Button
              type="button"
              variant="ghost"
              className="px-0 text-xs text-primary"
              disabled={disabled}
              aria-expanded={showTitle}
              aria-controls={`${id}-title-region`}
              onClick={() => setShowTitle((value) => !value)}
            >
              <Plus aria-hidden="true" className="size-4" />{" "}
              {showTitle ? "제목 접기" : "제목 추가"}
            </Button>
            <div
              id={`${id}-title-region`}
              hidden={!showTitle}
              className="space-y-2"
            >
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
                <p
                  id={`${id}-title-error`}
                  className="text-sm text-destructive"
                >
                  {mutation.fieldErrors.title[0]}
                </p>
              )}
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={disabled || !selectedStart || !selectedEnd}
            >
              {mutation.pending && (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin motion-reduce:animate-none"
                />
              )}
              {mutation.pending ? "예약하고 있어요" : "예약하기"}
            </Button>
          </>
        )}
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-destructive empty:hidden"
        >
          {mutation.message}
        </p>
      </form>
    </div>
  );
}
