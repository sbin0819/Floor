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
