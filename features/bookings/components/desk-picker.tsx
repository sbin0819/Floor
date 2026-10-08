"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { SeatMap } from "@/components/seat-map";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { createDeskBooking } from "@/features/bookings/actions";
import { deskPartLabels, type DeskPart } from "@/features/bookings/desk-parts";
import {
  formatBookingDate,
  formatBookingTime,
} from "@/features/bookings/format";
import type { DeskDayData, SpaceDayData } from "@/features/bookings/types";
import { cn } from "@/lib/utils";
import {
  bookingDraftScope,
  type BookingDraftStore,
} from "../booking-draft-store";
import { useFloorSelection } from "./branch-workspace";
import { BookingActorField } from "./booking-form-fields";
import { CancelBookingButton } from "./cancel-booking-button";
import { useBookingDeskSelection, useBookingDraft } from "./use-booking-draft";
import { useBookingMutation } from "./use-booking-mutation";

export function DeskPicker({
  data,
  desk,
}: {
  data: SpaceDayData;
  desk: DeskDayData;
}) {
  const id = useId();
  const workspace = useFloorSelection();
  const scope = bookingDraftScope(
    data.branch.id,
    data.floor.id,
    data.date,
    data.space.id,
  );
  const shared = useBookingDeskSelection(workspace?.draftStore, scope);
  const draft = useBookingDraft(workspace?.draftStore, scope);
  const [localPart, setLocalPart] = useState<DeskPart | null>(null);
  const [localDeskId, setLocalDeskId] = useState<string | null>(null);
  const [localActor, setLocalActor] = useState<string | null>(null);
  const chosenPart = workspace ? shared.deskPart : localPart;
  const selectedId = workspace ? shared.deskId : localDeskId;
  const part =
    desk.parts.find((part) => part.part === chosenPart && part.selectable) ??
    desk.parts.find((part) => part.part === "day" && part.selectable) ??
    desk.parts.find((part) => part.selectable);
  const actorId = workspace ? draft.actorId : localActor;
  const actor =
    data.actors.find((actor) => (actor.teamId ?? "personal") === actorId) ??
    data.actors[0];
  const seats = desk.seats.map((seat) => ({
    ...seat,
    state: part
      ? (seat.states[part.part] ?? "unavailable")
      : ("unavailable" as const),
  }));
  const selectedSeat = seats.find(
    (seat) =>
      seat.id === selectedId &&
      (seat.state === "free" || seat.state === "mine"),
  );
  const overlap =
    part &&
    desk.myBookings.find(
      (booking) => booking.start < part.end && booking.end > part.start,
    );
  const ownBooking =
    selectedSeat?.state === "mine"
      ? desk.myBookings.find(
          (booking) =>
            booking.deskId === selectedSeat.id &&
            part &&
            booking.start < part.end &&
            booking.end > part.start,
        )
      : undefined;
  const currentScope = useRef(scope);
  const previousPart = useRef(part?.part);
  const submitted = useRef<{
    scope: string;
    deskId: string;
    part: DeskPart;
    store?: BookingDraftStore;
  } | null>(null);
  useLayoutEffect(() => {
    currentScope.current = scope;
  }, [scope]);

  const setSeat = (deskId: string | null) => {
    if (workspace) workspace.draftStore.getState().changeDesk(scope, deskId);
    else setLocalDeskId(deskId);
  };
  // 데이터 도착이나 행에서의 시간 선택도 현재 범위의 선택에만 반영한다.
  useEffect(() => {
    if (!workspace || !part) return;
    const state = workspace.draftStore.getState();
    if (state.scope !== scope) return;
    state.changeDeskPart(scope, part.part);
    if (
      state.deskId &&
      !seats.some(
        (seat) =>
          seat.id === state.deskId &&
          (seat.state === "free" ||
            (previousPart.current === part.part && seat.state === "mine")),
      )
    )
      state.changeDesk(scope, null);
    previousPart.current = part.part;
  }, [workspace, scope, part, seats]);

  const clearSubmittedSeat = () => {
    const completed = submitted.current;
    submitted.current = null;
    if (!completed) return;
    if (completed.store) {
      const state = completed.store.getState();
      if (
        state.scope === completed.scope &&
        state.deskId === completed.deskId &&
        state.deskPart === completed.part
      )
        state.changeDesk(completed.scope, null);
    } else if (currentScope.current === completed.scope) setLocalDeskId(null);
  };
  const mutation = useBookingMutation({
    action: createDeskBooking,
    successMessage: "자리를 예약했어요",
    errorOptions: { desk: true, limits: actor?.limits },
    onSuccess: clearSubmittedSeat,
    onFailure: (result) => {
      if (result.code === "BOOKING_CONFLICT") clearSubmittedSeat();
    },
  });
  const setPart = (value: string) => {
    const next = desk.parts.find(
      (part) => part.part === value && part.selectable,
    );
    if (!next || mutation.pending) return;
    if (workspace)
      workspace.draftStore.getState().changeDeskPart(scope, next.part);
    else setLocalPart(next.part);
    if (
      selectedId &&
      desk.seats.find((seat) => seat.id === selectedId)?.states[next.part] !==
        "free"
    )
      setSeat(null);
  };
  const disabled =
    mutation.pending ||
    !part ||
    !actor ||
    !selectedSeat ||
    selectedSeat.state !== "free" ||
    Boolean(overlap);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 space-y-2 border-b border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold" id={`${id}-part-label`}>
            이용 시간
          </h3>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatBookingDate(data.date, data.branch.timezone)}
          </span>
        </div>
        <RadioGroup
          aria-labelledby={`${id}-part-label`}
          value={part?.part ?? ""}
          onValueChange={setPart}
          className="grid-cols-3"
        >
          {desk.parts.map((item) => (
            <label
              key={item.part}
              htmlFor={`${id}-${item.part}`}
              className={cn(
                "relative flex min-h-24 cursor-pointer flex-col gap-1 rounded-lg border border-border p-2 text-center text-xs tabular-nums has-focus-visible:ring-2 has-focus-visible:ring-ring",
                item.part === part?.part && "border-primary bg-accent",
                (!item.selectable || mutation.pending) &&
                  "cursor-not-allowed opacity-50",
              )}
            >
              <RadioGroupItem
                id={`${id}-${item.part}`}
                value={item.part}
                aria-disabled={!item.selectable || mutation.pending}
                onClick={(event) => {
                  if (!item.selectable || mutation.pending)
                    event.preventDefault();
                }}
                className="sr-only"
              />
              <span className="text-sm font-bold">
                {deskPartLabels[item.part]}
              </span>
              <span>
                {formatBookingTime(item.start, item.end, data.branch.timezone)}
              </span>
              <span>
                {item.selectable
                  ? `빈 자리 ${item.freeCount}석`
                  : "이용 시간이 지났어요"}
              </span>
            </label>
          ))}
        </RadioGroup>
        {!part && (
          <p className="text-sm text-muted-foreground">
            오늘은 예약할 수 있는 시간이 지났어요
          </p>
        )}
      </div>
      <div className="flex min-h-28 flex-1 flex-col overflow-hidden p-4">
        <SeatMap
          seats={seats}
          selectedId={selectedSeat?.id ?? null}
          disabled={mutation.pending}
          onSelect={setSeat}
        />
      </div>
      <form
        aria-label="좌석 예약 양식"
        className="shrink-0 space-y-3 border-t border-border p-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (disabled || !selectedSeat || !part || !actor) return;
          submitted.current = {
            scope,
            deskId: selectedSeat.id,
            part: part.part,
            store: workspace?.draftStore,
          };
          void mutation.submit({
            deskId: selectedSeat.id,
            date: data.date,
            part: part.part,
            teamId: actor.teamId,
          });
        }}
      >
        <div aria-live="polite" className="text-sm tabular-nums">
          {selectedSeat && part ? (
            <>
              <p className="font-bold">
                {selectedSeat.name} · {deskPartLabels[part.part]}
              </p>
              <p>
                {formatBookingDate(data.date, data.branch.timezone)} ·{" "}
                {formatBookingTime(part.start, part.end, data.branch.timezone)}
              </p>
            </>
          ) : (
            <p>자리를 골라 주세요</p>
          )}
        </div>
        {ownBooking ? (
          <div className="flex items-center justify-between gap-2 text-sm">
            <p>
              내 예약 ·{" "}
              {formatBookingTime(
                ownBooking.start,
                ownBooking.end,
                data.branch.timezone,
              )}
            </p>
            {ownBooking.canCancel && (
              <CancelBookingButton
                bookingId={ownBooking.id}
                triggerLabel="예약 취소"
              />
            )}
          </div>
        ) : (
          <>
            {actor ? (
              <BookingActorField
                id={id}
                variant="panel"
                value={actor.teamId ?? "personal"}
                options={data.actors.map((actor) => ({
                  value: actor.teamId ?? "personal",
                  label: actor.name,
                }))}
                disabled={mutation.pending}
                onChange={(actorId) => {
                  if (workspace)
                    workspace.draftStore
                      .getState()
                      .changeDraft(scope, { actorId });
                  else setLocalActor(actorId);
                }}
              />
            ) : (
              <p className="text-sm text-muted-foreground">
                이 공간을 예약할 권한이 없어요
              </p>
            )}
            {overlap && (
              <p className="text-sm text-muted-foreground">
                이 시간에 이미 {overlap.deskName} 자리를 예약했어요. 자리를
                옮기려면 먼저 취소해 주세요
              </p>
            )}
            <Button className="w-full" disabled={disabled} type="submit">
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
        <p role="status" className="text-sm text-destructive">
          {mutation.message}
        </p>
        <p className="text-xs text-muted-foreground">
          좌석은 같은 시간에 한 자리만 예약할 수 있어요
          {actor?.limits.maxDaysAhead != null &&
            ` · ${actor.limits.maxDaysAhead}일 뒤까지`}
        </p>
      </form>
    </div>
  );
}
