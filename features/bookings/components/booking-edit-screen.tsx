"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AttendeeCountInput } from "@/components/attendee-count-input";
import { ParticipantInput } from "@/components/participant-input";
import { SpacePhoto } from "@/components/photos/space-photo";
import { Button, buttonVariants } from "@/components/ui/button";
import { updateBooking } from "@/features/bookings/actions";
import { attendeeCountError } from "@/features/bookings/attendee-count";
import {
  editParticipantsPayload,
  editTimeOptions,
  sameBookingEdit,
  type BookingEditDraft,
} from "@/features/bookings/booking-edit";
import {
  formatBookingDate,
  formatBookingTime,
  spaceTypeLabels,
} from "@/features/bookings/format";
import {
  MAX_GUEST_PARTICIPANTS,
  MAX_PARTICIPANTS,
} from "@/features/bookings/participants";
import {
  selectableEnds,
  selectableSlots,
  selectBookingSlot,
  suggestedEnd,
} from "@/features/bookings/selection";
import type { BookingForEditData } from "@/features/bookings/types";
import { localDate } from "@/lib/time/zoned";
import { BookingTimeFields, BookingTitleField } from "./booking-form-fields";
import { BookingTimeline } from "./booking-timeline";
import { CancelBookingButton } from "./cancel-booking-button";
import { useBookingMutation } from "./use-booking-mutation";

export function BookingEditScreen({ data }: { data: BookingForEditData }) {
  return <BookingEditSession key={data.booking.id} data={data} />;
}

function BookingEditSession({ data }: { data: BookingForEditData }) {
  const id = useId();
  const router = useRouter();
  // 충돌 후 새 조회가 와도 화면을 열었을 때의 명단과 편집 의도는 바꾸지 않는다.
  const [initial] = useState<BookingEditDraft>(() => ({
    ...data.booking,
    title: data.booking.title ?? "",
    participants: data.participants,
  }));
  const [draft, setDraft] = useState(initial);
  const [notFound, setNotFound] = useState(false);
  const active = useRef(false);
  const attendeeRef = useRef<HTMLInputElement>(null);
  const participantRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const participantIdsAtLoad = initial.participants.map(({ userId }) => userId);
  const latestParticipants = new Map(
    data.participants.map((person) => [person.userId, person]),
  );
  const participants = draft.participants.map(
    (person) => latestParticipants.get(person.userId) ?? person,
  );
  const capacity = data.space.capacity;
  const countError = attendeeCountError(
    draft.attendeeCount,
    capacity,
    draft.participants.length + 1,
  );
  const participantError =
    capacity !== null && draft.participants.length + 1 > capacity
      ? `참석자가 정원(${capacity}명)보다 많아요`
      : participants.filter(
            ({ sharedTeamNames }) => sharedTeamNames.length === 0,
          ).length > MAX_GUEST_PARTICIPANTS
        ? "손님은 5명까지예요"
        : draft.participants.length > MAX_PARTICIPANTS
          ? "참석자는 20명까지 초대할 수 있어요"
          : undefined;
  const mutation = useBookingMutation({
    action: updateBooking,
    successMessage: "예약을 바꿨어요",
    errorOptions: {
      edit: true,
      capacity,
      limits: data.actor.limits,
      isToday:
        data.date === localDate(new Date(data.now), data.branch.timezone),
    },
    onSuccess: () => {
      if (active.current) router.push("/bookings");
    },
    onFailure: (result) => setNotFound(result.code === "NOT_FOUND"),
  });
  useLayoutEffect(() => {
    if (mutation.fieldErrors.attendeeCount?.length)
      attendeeRef.current?.focus();
    else if (mutation.fieldErrors.participants?.length)
      participantRef.current?.focus();
  }, [mutation.fieldErrors]);
  const slots = selectableSlots(data);
  const startOptions = editTimeOptions(
    slots
      .filter((slot) => slot.state === "free")
      .map((slot) => ({ value: slot.start, label: slot.label })),
    [initial.start, draft.start],
    draft.start,
    data.branch.timezone,
    "start",
  );
  const endOptions = editTimeOptions(
    selectableEnds(slots, draft.start).map((slot) => ({
      value: slot.end,
      label: slot.endLabel,
    })),
    [initial.end, draft.end],
    draft.start,
    data.branch.timezone,
    "end",
  );
  const disabled = mutation.pending || notFound;
  const changed = !sameBookingEdit(initial, draft);
  const valid =
    Boolean(draft.start && draft.end) &&
    Date.parse(draft.end) > Date.parse(draft.start) &&
    !countError &&
    !participantError;
  const showPeople =
    capacity !== 1 ||
    (initial.attendeeCount ?? 0) > 1 ||
    initial.participants.length > 0 ||
    (draft.attendeeCount ?? 0) > 1 ||
    draft.participants.length > 0;
  const originalTime = formatBookingTime(
    initial.start,
    initial.end,
    data.branch.timezone,
  ).split("–");
  const currentTime = formatBookingTime(
    draft.start,
    draft.end,
    data.branch.timezone,
  ).split("–");
  const timeChanged =
    Date.parse(initial.start) !== Date.parse(draft.start) ||
    Date.parse(initial.end) !== Date.parse(draft.end);
  const setRange = (start: string, end: string) =>
    setDraft((value) => ({ ...value, start, end }));
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside
        className="overflow-hidden rounded-xl border border-border bg-card shadow-card"
        aria-label="바꾸는 예약 정보"
      >
        <div className="aspect-[16/9]">
          <SpacePhoto
            photo={data.space.photo}
            type={data.space.type}
            size="fill"
            sizes="(min-width: 1024px) 320px, 100vw"
            eager
          />
        </div>
        <div className="space-y-5 p-5">
          <div>
            <p className="text-xs text-muted-foreground">
              {spaceTypeLabels[data.space.type]}
            </p>
            <h2 className="text-xl font-bold">{data.space.name}</h2>
            <p className="text-sm text-muted-foreground">
              {capacity === null ? "정원 제한 없음" : `정원 ${capacity}명`} ·{" "}
              {data.branch.name} {data.floor.name}
            </p>
          </div>
          <dl className="space-y-3 text-sm">
            <div>
              <dt className="text-muted-foreground">날짜</dt>
              <dd className="tabular-nums">
                {formatBookingDate(data.date, data.branch.timezone)}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">예약 방식</dt>
              <dd>{data.actor.name}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">지금 예약</dt>
              <dd className="tabular-nums">
                {formatBookingTime(
                  data.booking.start,
                  data.booking.end,
                  data.branch.timezone,
                )}
                {data.booking.attendeeCount !== null &&
                  ` · ${data.booking.attendeeCount}명`}
                {data.participants.length > 0 &&
                  ` · 참석자 ${data.participants.length}명`}
              </dd>
            </div>
          </dl>
          <p className="border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
            공간이나 날짜, 예약 방식을 바꾸려면 취소하고 다시 예약해 주세요.
            시간을 바꾸면 참석자에게 알려드려요.
          </p>
        </div>
      </aside>
      <section
        className="space-y-5 rounded-xl border border-border bg-card p-5 shadow-card"
        aria-label="예약 수정"
      >
        <div className="space-y-3">
          <h2 className="font-bold">하루 일정</h2>
          <p className="text-xs text-muted-foreground">
            빈 시간을 누르면 시작과 끝을 함께 바꿀 수 있어요.
          </p>
          <div className="max-h-80 overflow-y-auto overscroll-contain py-1 pr-2">
            {slots.length ? (
              <BookingTimeline
                slots={slots}
                bookings={data.bookings}
                blocks={data.blocks}
                timeZone={data.branch.timezone}
                now={data.now}
                date={data.date}
                start={draft.start}
                end={draft.end}
                disabled={disabled || data.booking.started}
                selectionLabel="바꾼 시간"
                onSelect={(start) => {
                  const next = selectBookingSlot(slots, draft, start);
                  if (next) setRange(next.start, next.end);
                }}
                renderCancel={(bookingId) => (
                  <CancelBookingButton bookingId={bookingId} />
                )}
              />
            ) : (
              <p className="py-8 text-center text-sm text-muted-foreground">
                이 날은 운영하지 않아요. 인원, 참석자와 제목은 바꿀 수 있어요.
              </p>
            )}
          </div>
        </div>
        {data.booking.started && (
          <p className="text-sm text-muted-foreground">
            진행 중인 예약은 시간을 바꿀 수 없어요
          </p>
        )}
        <form
          aria-label="예약 바꾸기 양식"
          className="space-y-5 border-t border-border pt-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (disabled || !changed || !valid) return;
            void mutation.submit({
              bookingId: data.booking.id,
              start: draft.start,
              end: draft.end,
              attendeeCount: draft.attendeeCount,
              title: draft.title,
              participants: editParticipantsPayload(
                participants,
                participantIdsAtLoad,
              ),
              participantIdsAtLoad,
            });
          }}
        >
          <BookingTimeFields
            id={id}
            variant="panel"
            className="grid-cols-1 sm:grid-cols-2"
            start={draft.start}
            end={draft.end}
            disabled={disabled || data.booking.started}
            startOptions={startOptions}
            endOptions={endOptions}
            startError={mutation.fieldErrors.start?.[0]}
            endError={mutation.fieldErrors.end?.[0]}
            startChangeNote={
              Date.parse(draft.start) !== Date.parse(initial.start)
                ? `${originalTime[0]} → ${currentTime[0]}`
                : undefined
            }
            endChangeNote={
              Date.parse(draft.end) !== Date.parse(initial.end)
                ? `${originalTime[1]} → ${currentTime[1]}`
                : undefined
            }
            onStartChange={(start) =>
              setRange(
                start,
                Date.parse(start) === Date.parse(initial.start)
                  ? initial.end
                  : suggestedEnd(slots, start) || draft.end,
              )
            }
            onEndChange={(end) => setRange(draft.start, end)}
          />
          {showPeople && (
            <>
              <AttendeeCountInput
                id={`${id}-count`}
                inputRef={attendeeRef}
                value={draft.attendeeCount}
                capacity={capacity}
                minimum={draft.participants.length + 1}
                disabled={disabled}
                error={countError || mutation.fieldErrors.attendeeCount?.[0]}
                onChange={(attendeeCount) =>
                  setDraft((value) => ({ ...value, attendeeCount }))
                }
              />
              <ParticipantInput
                id={`${id}-participants`}
                inputRef={participantRef}
                value={participants}
                maxParticipants={Math.min(
                  MAX_PARTICIPANTS,
                  capacity === null
                    ? MAX_PARTICIPANTS
                    : Math.max(0, capacity - 1),
                )}
                disabled={disabled}
                error={
                  participantError || mutation.fieldErrors.participants?.[0]
                }
                onChange={(participants) =>
                  setDraft((value) => ({
                    ...value,
                    participants,
                    attendeeCount:
                      value.attendeeCount === null
                        ? null
                        : Math.max(
                            value.attendeeCount,
                            participants.length + 1,
                          ),
                  }))
                }
              />
            </>
          )}
          <BookingTitleField
            id={id}
            variant="panel"
            value={draft.title}
            disabled={disabled}
            errors={mutation.fieldErrors.title}
            onChange={(title) => setDraft((value) => ({ ...value, title }))}
          />
          <p className="text-xs text-muted-foreground tabular-nums">
            {data.actor.limits.maxMinutesPerBooking === null
              ? "1회 시간 제한 없음"
              : `1회 최대 ${data.actor.limits.maxMinutesPerBooking / 60}시간`}{" "}
            ·{" "}
            {data.actor.remainingMinutes === null
              ? "하루 시간 제한 없음"
              : `이 예약을 빼면 ${data.actor.remainingMinutes}분 남음`}
            {timeChanged && " · 바꾼 시간은 저장할 때 다시 확인해요"}
          </p>
          <div
            aria-live="polite"
            aria-atomic="true"
            className="text-sm text-destructive"
          >
            {mutation.message}
            {notFound && (
              <a href="/bookings" className="ml-2 underline">
                내 예약으로
              </a>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={disabled || !changed || !valid}>
              {mutation.pending ? "저장하고 있어요" : "바꾼 내용 저장"}
            </Button>
            <a
              href="/bookings"
              className={buttonVariants({ variant: "outline" })}
            >
              돌아가기
            </a>
          </div>
        </form>
      </section>
    </div>
  );
}
