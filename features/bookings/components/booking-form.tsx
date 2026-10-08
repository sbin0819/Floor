"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { AttendeeCountInput } from "@/components/attendee-count-input";
import {
  attendeeCountError,
  effectiveAttendeeCount,
} from "@/features/bookings/attendee-count";
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
  bookingDraftScope,
  type BookingDraftStore,
} from "../booking-draft-store";
import { useBookingDraft, useBookingRange } from "./use-booking-draft";
import {
  BookingTimeFields,
  BookingTitleField,
  BookingActorField,
  type BookingFormVariant,
} from "./booking-form-fields";
import { BookingFormLayout } from "./booking-form-layout";
import { useFloorPeople } from "./floor-view";
import { BookingParticipantsField } from "./booking-participants-field";
import {
  MAX_PARTICIPANTS,
  type BookingParticipantDraft,
} from "../participants";

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
  const { people } = useFloorPeople();
  const scope = bookingDraftScope(
    data.branch.id,
    data.floor.id,
    data.date,
    data.space.id,
  );
  const sharedRange = useBookingRange(workspace?.draftStore, scope);
  const sharedDraft = useBookingDraft(workspace?.draftStore, scope);
  const currentScope = useRef(scope);
  useLayoutEffect(() => {
    currentScope.current = scope;
  }, [scope]);
  const submitted = useRef<{
    scope: string;
    spaceId: string;
    store?: BookingDraftStore;
    onBooked?: () => void;
  } | null>(null);
  const [localRange, setLocalRange] = useState<{
    start: string;
    end: string;
  } | null>(null);
  const range = workspace ? sharedRange : localRange;
  const start = range?.start ?? "";
  const end = range?.end ?? "";
  const setRange = (next: { start: string; end: string } | null) => {
    if (workspace)
      workspace.draftStore.getState().changeRange(scope, data.space.id, next);
    else setLocalRange(next);
  };
  const [localTitle, setLocalTitle] = useState("");
  const [localAttendeeCount, setLocalAttendeeCount] = useState<number | null>(
    null,
  );
  const [localAttendeeCountTouched, setLocalAttendeeCountTouched] =
    useState(false);
  const attendeeInputRef = useRef<HTMLInputElement>(null);
  const participantInputRef = useRef<HTMLInputElement>(null);
  const [localParticipants, setLocalParticipants] = useState<
    BookingParticipantDraft[]
  >([]);
  const [expanded, setExpanded] = useState(false);
  const [localActorId, setLocalActorId] = useState(
    data.actors[0]?.teamId ?? "personal",
  );
  const title = workspace ? sharedDraft.title : localTitle;
  const actorId = workspace ? sharedDraft.actorId : localActorId;
  const showAttendeeCount = data.space.bookable && data.space.capacity !== 1;
  const participants = showAttendeeCount
    ? workspace
      ? sharedDraft.participants
      : localParticipants
    : [];
  const attendeeCount = showAttendeeCount
    ? effectiveAttendeeCount(
        workspace
          ? sharedDraft
          : {
              attendeeCount: localAttendeeCount,
              attendeeCountTouched: localAttendeeCountTouched,
            },
        people,
        data.space.capacity,
      )
    : null;
  const attendeeError = attendeeCountError(
    attendeeCount,
    data.space.capacity,
    participants.length + 1,
  );
  const maxParticipants = Math.max(
    0,
    Math.min(
      MAX_PARTICIPANTS,
      (data.space.capacity ?? MAX_PARTICIPANTS + 1) - 1,
    ),
  );
  const participantError =
    participants.length > maxParticipants
      ? `참석자가 정원(${data.space.capacity}명)보다 많아요`
      : undefined;
  const setParticipants = (next: BookingParticipantDraft[]) => {
    const raisedCount =
      next.length > participants.length &&
      attendeeCount !== null &&
      attendeeCount < next.length + 1
        ? next.length + 1
        : null;
    if (workspace)
      workspace.draftStore.getState().changeDraft(scope, {
        participants: next,
        ...(raisedCount !== null
          ? { attendeeCount: raisedCount, attendeeCountTouched: true }
          : {}),
      });
    else {
      setLocalParticipants(next);
      if (raisedCount !== null) {
        setLocalAttendeeCount(raisedCount);
        setLocalAttendeeCountTouched(true);
      }
    }
  };
  const setAttendeeCount = (value: number | null) => {
    if (workspace)
      workspace.draftStore.getState().changeDraft(scope, {
        attendeeCount: value,
        attendeeCountTouched: true,
      });
    else {
      setLocalAttendeeCount(value);
      setLocalAttendeeCountTouched(true);
    }
  };
  const setTitle = (value: string) => {
    if (workspace)
      workspace.draftStore.getState().changeDraft(scope, { title: value });
    else setLocalTitle(value);
  };
  const setActorId = (value: string) => {
    if (workspace)
      workspace.draftStore.getState().changeDraft(scope, { actorId: value });
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
      capacity: data.space.capacity,
    },
    onSuccess: () => {
      // mutation 옵션은 재렌더링으로 바뀔 수 있어 제출 때의 범위로만 정리한다.
      const completed = submitted.current;
      submitted.current = null;
      if (!completed) return;
      if (completed.store) {
        completed.store
          .getState()
          .changeRange(completed.scope, completed.spaceId, null);
        completed.store.getState().clearBookingContent(completed.scope);
      }
      if (currentScope.current === completed.scope) {
        if (!completed.store) {
          setLocalRange(null);
          setLocalTitle("");
          setLocalAttendeeCount(null);
          setLocalAttendeeCountTouched(false);
          setLocalParticipants([]);
        }
        setExpanded(false);
      }
      completed.onBooked?.();
    },
  });
  const [previousErrors, setPreviousErrors] = useState(mutation.fieldErrors);
  if (previousErrors !== mutation.fieldErrors) {
    setPreviousErrors(mutation.fieldErrors);
    if (
      ["start", "end", "title", "attendeeCount", "participants"].some(
        (key) => mutation.fieldErrors[key]?.length,
      )
    )
      setExpanded(true);
  }
  useLayoutEffect(() => {
    if (mutation.fieldErrors.attendeeCount?.length)
      attendeeInputRef.current?.focus();
    else if (mutation.fieldErrors.participants?.length)
      participantInputRef.current?.focus();
  }, [mutation.fieldErrors, expanded]);
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
            {attendeeCount !== null && ` · ${attendeeCount}명`}
            {participants.length > 0 && ` · 참석자 ${participants.length}명`}
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
  const attendeeInput = showAttendeeCount && (
    <AttendeeCountInput
      id={`${id}-attendee-count`}
      inputRef={attendeeInputRef}
      value={attendeeCount}
      capacity={data.space.capacity}
      minimum={participants.length + 1}
      disabled={disabled}
      error={mutation.fieldErrors.attendeeCount?.[0]}
      className={variant === "strip" ? "min-w-36" : undefined}
      onChange={setAttendeeCount}
    />
  );
  const participantsInput = showAttendeeCount && (
    <BookingParticipantsField
      id={`${id}-participants`}
      variant={variant}
      value={participants}
      onChange={setParticipants}
      maxParticipants={maxParticipants}
      disabled={disabled}
      inputRef={participantInputRef}
      error={mutation.fieldErrors.participants?.[0] ?? participantError}
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
      disabled={
        disabled ||
        !selected ||
        Boolean(attendeeError) ||
        Boolean(participantError)
      }
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
      attendeeInput={attendeeInput}
      participantsInput={participantsInput}
      titleInput={titleInput}
      actorInput={actorInput}
      submitButton={submitButton}
      limit={limit}
      onToggle={() => setExpanded((value) => !value)}
      onSubmit={(event) => {
        event.preventDefault();
        if (
          !actor ||
          !selectedStart ||
          !selectedEnd ||
          disabled ||
          attendeeError ||
          participantError
        )
          return;
        submitted.current = {
          scope,
          spaceId: data.space.id,
          store: workspace?.draftStore,
          onBooked,
        };
        void mutation.submit({
          spaceId: data.space.id,
          start: selectedStart,
          end: selectedEnd,
          teamId: actor.teamId,
          title,
          attendeeCount,
          ...(participants.length > 0
            ? {
                participants: participants.map(({ userId, email }) => ({
                  userId,
                  ...(email ? { email } : {}),
                })),
              }
            : {}),
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
