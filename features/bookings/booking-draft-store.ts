import { createStore } from "zustand/vanilla";
import type { BookingSelection, FloorBookingSelection } from "./selection";
import type { DeskPart } from "./desk-parts";
import type { BookingParticipantDraft } from "./participants";

export type BookingDraft = Readonly<{
  title: string;
  actorId: string | null;
  attendeeCount: number | null;
  attendeeCountTouched: boolean;
  participants: readonly BookingParticipantDraft[];
}>;
export const emptyBookingDraft: BookingDraft = {
  title: "",
  actorId: null,
  attendeeCount: null,
  attendeeCountTouched: false,
  participants: [],
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
  deskPart: DeskPart | null;
  deskId: string | null;
  activate: (scope: string) => void;
  changeDraft: (scope: string, patch: Partial<BookingDraft>) => void;
  changeRange: (
    scope: string,
    spaceId: string,
    range: BookingSelection | null,
  ) => void;
  clearBookingContent: (scope: string) => void;
  changeDeskPart: (scope: string, part: DeskPart | null) => void;
  changeDesk: (scope: string, deskId: string | null) => void;
};

export function createBookingDraftStore() {
  return createStore<BookingDraftState>()((set) => ({
    scope: null,
    draft: emptyBookingDraft,
    range: null,
    deskPart: null,
    deskId: null,
    activate: (scope) =>
      set((state) =>
        state.scope === scope
          ? state
          : {
              scope,
              draft: emptyBookingDraft,
              range: null,
              deskPart: null,
              deskId: null,
            },
      ),
    changeDraft: (scope, patch) =>
      set((state) => {
        if (state.scope !== scope) return state;
        const draft = { ...state.draft, ...patch };
        return draft.title === state.draft.title &&
          draft.actorId === state.draft.actorId &&
          draft.attendeeCount === state.draft.attendeeCount &&
          draft.attendeeCountTouched === state.draft.attendeeCountTouched &&
          draft.participants === state.draft.participants
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
          state.draft.attendeeCountTouched ||
          state.draft.participants.length > 0)
          ? {
              draft: {
                ...state.draft,
                title: "",
                attendeeCount: null,
                attendeeCountTouched: false,
                participants: emptyBookingDraft.participants,
              },
            }
          : state,
      ),
    changeDeskPart: (scope, deskPart) =>
      set((state) =>
        state.scope === scope && state.deskPart !== deskPart
          ? { deskPart }
          : state,
      ),
    changeDesk: (scope, deskId) =>
      set((state) =>
        state.scope === scope && state.deskId !== deskId ? { deskId } : state,
      ),
  }));
}

export type BookingDraftStore = ReturnType<typeof createBookingDraftStore>;
