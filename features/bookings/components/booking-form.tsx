"use client";

import { useId, useMemo, useState } from "react";
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
  suggestedEnd,
} from "@/features/bookings/selection";
import type { SpaceDayData } from "@/features/bookings/types";
import { localDate } from "@/lib/time/zoned";
import { BookingTimeline } from "./booking-timeline";
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
          <SelectValue placeholder={`${label} 시각 선택`} />
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
  return (
    <form
      className="space-y-5"
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
      <BookingTimeline
        slots={slots}
        timeZone={data.branch.timezone}
        now={data.now}
        date={data.date}
        start={selectedStart}
        end={selectedEnd}
        disabled={disabled}
        onSelect={selectStart}
      />
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
          {data.hasTeams && (
            <div className="space-y-2">
              <Label htmlFor={`${id}-actor`}>예약 방식</Label>
              <Select
                value={actor?.teamId ?? "personal"}
                onValueChange={setActorId}
                disabled={disabled}
              >
                <SelectTrigger id={`${id}-actor`} className="min-h-11 w-full">
                  <SelectValue placeholder="예약 방식 선택" />
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
            <p className="text-sm text-muted-foreground tabular-nums">
              {actor.teamId === null ? "개인" : "팀"} 예약은{" "}
              {actor.limits.maxMinutesPerDay === null
                ? "하루 한도가 없어요"
                : `하루 ${actor.limits.maxMinutesPerDay / 60}시간까지`}
              {actor.remainingMinutes !== null &&
                ` · ${isToday ? "오늘" : "이 날"} ${actor.remainingMinutes / 60}시간 남음`}
            </p>
          )}
          {!actor && <p>이 공간을 예약할 권한이 없어요</p>}
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
          <div className="space-y-2">
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
              <p id={`${id}-title-error`} className="text-sm text-destructive">
                {mutation.fieldErrors.title[0]}
              </p>
            )}
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={disabled || !selectedStart || !selectedEnd}
          >
            {mutation.pending ? "예약하고 있어요" : "예약하기"}
          </Button>
        </>
      )}
      <p role="status" aria-live="polite" className="text-sm text-destructive">
        {mutation.message}
      </p>
    </form>
  );
}
