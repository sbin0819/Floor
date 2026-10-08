import { createStore } from "zustand/vanilla";
import type { BookingSelection, FloorBookingSelection } from "./selection";

export type BookingDraft = Readonly<{
  title: string;
  actorId: string | null;
  attendeeCount: number | null;
  attendeeCountTouched: boolean;
}>;
export const emptyBookingDraft: BookingDraft = {
  title: "",
  actorId: null,
  attendeeCount: null,
  attendeeCountTouched: false,
};

export function bookingDraftScope(
  branchId: string,
  floorId: string,
  date: string,
  spaceId: string | null,
) {
  return `${branchId.toLowerCase()}|${floorId.toLowerCase()}|${date}|${spaceId?.toLowerCase() ?? ""}`;
}

export type BookingDraftState = {
  scope: string | null;
  draft: BookingDraft;
  range: FloorBookingSelection | null;
  activate: (scope: string) => void;
  changeDraft: (scope: string, patch: Partial<BookingDraft>) => void;
  changeRange: (
    scope: string,
    spaceId: string,
    range: BookingSelection | null,
  ) => void;
  clearBookingContent: (scope: string) => void;
};

export function createBookingDraftStore() {
  return createStore<BookingDraftState>()((set) => ({
    scope: null,
    draft: emptyBookingDraft,
    range: null,
    activate: (scope) =>
      set((state) =>
        state.scope === scope
          ? state
          : { scope, draft: emptyBookingDraft, range: null },
      ),
    changeDraft: (scope, patch) =>
      set((state) => {
        if (state.scope !== scope) return state;
        const draft = { ...state.draft, ...patch };
        return draft.title === state.draft.title &&
          draft.actorId === state.draft.actorId &&
          draft.attendeeCount === state.draft.attendeeCount &&
          draft.attendeeCountTouched === state.draft.attendeeCountTouched
          ? state
          : { draft };
      }),
    changeRange: (scope, spaceId, range) =>
      set((state) => {
        if (state.scope !== scope) return state;
        if (range === null)
          return state.range === null ? state : { range: null };
        return state.range?.spaceId === spaceId &&
          state.range.start === range.start &&
          state.range.end === range.end
          ? state
          : { range: { spaceId, ...range } };
      }),
    clearBookingContent: (scope) =>
      set((state) =>
        state.scope === scope &&
        (state.draft.title !== "" ||
          state.draft.attendeeCount !== null ||
          state.draft.attendeeCountTouched)
          ? {
              draft: {
                ...state.draft,
                title: "",
                attendeeCount: null,
                attendeeCountTouched: false,
              },
            }
          : state,
      ),
  }));
}

export type BookingDraftStore = ReturnType<typeof createBookingDraftStore>;
