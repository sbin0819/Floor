"use client";

import { useId, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
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
import {
  BookingTimeFields,
  BookingTitleField,
  BookingActorField,
  type BookingFormVariant,
} from "./booking-form-fields";
import { BookingFormLayout } from "./booking-form-layout";

export function BookingForm({
  data,
  variant = "panel",
  onBooked,
}: {
  data: SpaceDayData;
  variant?: BookingFormVariant;
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
  const [localTitle, setLocalTitle] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [localActorId, setLocalActorId] = useState(
    data.actors[0]?.teamId ?? "personal",
  );
  const title = workspace ? workspace.draft.title : localTitle;
  const actorId = workspace ? workspace.draft.actorId : localActorId;
  const setTitle = (value: string) => {
    if (workspace) workspace.changeDraft(data.space.id, { title: value });
    else setLocalTitle(value);
  };
  const setActorId = (value: string) => {
    if (workspace) workspace.changeDraft(data.space.id, { actorId: value });
    else setLocalActorId(value);
  };
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
      if (workspace) workspace.clearDraftTitle(data.space.id);
      else setLocalTitle("");
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
    <BookingTimeFields
      id={id}
      variant={variant}
      start={selectedStart}
      end={selectedEnd}
      disabled={disabled}
      onStartChange={(value) =>
        setRange({ start: value, end: suggestedEnd(slots, value) })
      }
      onEndChange={(value) => setRange({ start, end: value })}
      startOptions={slots
        .filter((slot) => slot.state === "free")
        .map((slot) => ({ value: slot.start, label: slot.label }))}
      endOptions={ends.map((slot) => ({
        value: slot.end,
        label: slot.endLabel,
      }))}
      startError={mutation.fieldErrors.start?.[0]}
      endError={mutation.fieldErrors.end?.[0]}
    />
  );
  const titleInput = (
    <BookingTitleField
      id={id}
      variant={variant}
      value={title}
      disabled={disabled}
      errors={mutation.fieldErrors.title}
      onChange={setTitle}
    />
  );
  const actorInput = data.hasTeams && (
    <BookingActorField
      id={id}
      variant={variant}
      value={actor?.teamId ?? "personal"}
      label={actor?.name}
      options={data.actors.map((item) => ({
        value: item.teamId ?? "personal",
        label: item.name,
      }))}
      disabled={disabled}
      onChange={setActorId}
    />
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
    <BookingFormLayout
      id={id}
      variant={variant}
      bookable={data.space.bookable}
      deskCount={data.space.deskCount}
      selected={selected}
      expanded={expanded}
      disabled={disabled}
      hasActor={Boolean(actor)}
      overLimit={Boolean(overLimit)}
      message={mutation.message}
      summary={summary}
      times={times}
      titleInput={titleInput}
      actorInput={actorInput}
      submitButton={submitButton}
      limit={limit}
      onToggle={() => setExpanded((value) => !value)}
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
      timeline={
        <BookingTimeline
          branchId={data.branch.id}
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
      }
    />
  );
}
