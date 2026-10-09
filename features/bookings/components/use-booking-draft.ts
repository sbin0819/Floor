"use client";

import { useState } from "react";
import { useStore } from "zustand";
import {
  createBookingDraftStore,
  emptyBookingDraft,
  type BookingDraftStore,
} from "../booking-draft-store";

function useDraftStore(store?: BookingDraftStore) {
  const [local] = useState(createBookingDraftStore);
  return store ?? local;
}

export function useBookingDraft(store?: BookingDraftStore, scope?: string) {
  return useStore(useDraftStore(store), (state) =>
    state.scope === scope ? state.draft : emptyBookingDraft,
  );
}

export function useBookingRange(store?: BookingDraftStore, scope?: string) {
  return useStore(useDraftStore(store), (state) =>
    state.scope === scope ? state.range : null,
  );
}

export function useBookingParticipants(
  store?: BookingDraftStore,
  scope?: string,
) {
  return useStore(useDraftStore(store), (state) =>
    state.scope === scope
      ? state.draft.participants
      : emptyBookingDraft.participants,
  );
}

export function useBookingAttendeeCount(
  store?: BookingDraftStore,
  scope?: string,
) {
  const draftStore = useDraftStore(store);
  const attendeeCount = useStore(draftStore, (state) =>
    state.scope === scope ? state.draft.attendeeCount : null,
  );
  const attendeeCountTouched = useStore(draftStore, (state) =>
    state.scope === scope ? state.draft.attendeeCountTouched : false,
  );
  return { attendeeCount, attendeeCountTouched };
}

export function useBookingDeskSelection(
  store?: BookingDraftStore,
  scope?: string,
) {
  const draftStore = useDraftStore(store);
  const active = useStore(draftStore, (state) => state.scope === scope);
  const deskPart = useStore(draftStore, (state) =>
    state.scope === scope ? state.deskPart : null,
  );
  const deskId = useStore(draftStore, (state) =>
    state.scope === scope ? state.deskId : null,
  );
  return { deskPart, deskId, active };
}

export function useBookingDeskSeats(store?: BookingDraftStore, scope?: string) {
  return useStore(useDraftStore(store), (state) =>
    state.scope === scope ? state.deskSeats : null,
  );
}
