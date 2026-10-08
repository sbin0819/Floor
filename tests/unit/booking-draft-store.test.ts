import { describe, expect, it, vi } from "vitest";
import {
  bookingDraftScope,
  createBookingDraftStore,
} from "@/features/bookings/booking-draft-store";

const first = bookingDraftScope("branch", "floor", "2026-10-07", "space-a");
const second = bookingDraftScope("branch", "floor", "2026-10-07", "space-b");
const range = { start: "2026-10-07T01:00:00Z", end: "2026-10-07T02:00:00Z" };

describe("scoped booking draft store", () => {
  it("starts with a deterministic empty snapshot and canonicalizes IDs", () => {
    const store = createBookingDraftStore();
    expect(store.getState()).toMatchObject({
      scope: null,
      draft: {
        title: "",
        actorId: null,
        attendeeCount: null,
        attendeeCountTouched: false,
      },
      range: null,
      deskPart: null,
      deskId: null,
    });
    expect(store.getInitialState()).toBe(store.getState());
    expect(bookingDraftScope("BRANCH", "FLOOR", "2026-10-07", "SPACE-A")).toBe(
      first,
    );
  });

  it("keeps independent stores isolated even at the same scope", () => {
    const left = createBookingDraftStore();
    const right = createBookingDraftStore();
    left.getState().activate(first);
    right.getState().activate(first);
    left.getState().changeDraft(first, { title: "왼쪽 제목", actorId: "team" });
    left.getState().changeRange(first, "space-a", range);
    expect(right.getState()).toMatchObject({
      draft: { title: "", actorId: null },
      range: null,
    });
    expect(left.getInitialState()).toMatchObject({
      scope: null,
      draft: { title: "", actorId: null },
      range: null,
    });
  });

  it("preserves a preselected range and title when the matching URL commits", () => {
    const store = createBookingDraftStore();
    store.getState().activate(second);
    store.getState().changeRange(second, "space-b", range);
    store.getState().changeDraft(second, { title: "미리 고른 공간" });
    const snapshot = store.getState();
    store.getState().activate(second);
    expect(store.getState()).toBe(snapshot);
  });

  it.each([
    second,
    bookingDraftScope("other-branch", "floor", "2026-10-07", "space-a"),
    bookingDraftScope("branch", "other-floor", "2026-10-07", "space-a"),
    bookingDraftScope("branch", "floor", "2026-10-08", "space-a"),
    bookingDraftScope("branch", "floor", "2026-10-07", null),
  ])("clears both values when the active scope changes to %s", (next) => {
    const store = createBookingDraftStore();
    store.getState().activate(first);
    store
      .getState()
      .changeDraft(first, { title: "이전 제목", actorId: "team" });
    store.getState().changeRange(first, "space-a", range);
    store.getState().activate(next);
    expect(store.getState()).toMatchObject({
      scope: next,
      draft: { title: "", actorId: null },
      range: null,
    });
    store.getState().activate(first);
    expect(store.getState().draft.title).toBe("");
    expect(store.getState().range).toBeNull();
  });

  it("ignores stale edits and success cleanup for another full scope", () => {
    const store = createBookingDraftStore();
    store.getState().activate(second);
    store.getState().changeDraft(second, { title: "새 제목", actorId: "team" });
    store.getState().changeRange(second, "space-b", range);
    const snapshot = store.getState();
    store.getState().changeDraft(first, { title: "늦은 제목" });
    store.getState().changeRange(first, "space-a", null);
    store.getState().clearBookingContent(first);
    expect(store.getState()).toBe(snapshot);
  });

  it("clears a successful booking's range and title while retaining its actor", () => {
    const store = createBookingDraftStore();
    store.getState().activate(first);
    store
      .getState()
      .changeDraft(first, { title: "예약 제목", actorId: "team" });
    store.getState().changeRange(first, "space-a", range);
    store.getState().changeRange(first, "space-a", null);
    store.getState().clearBookingContent(first);
    expect(store.getState()).toMatchObject({
      scope: first,
      draft: { title: "", actorId: "team" },
      range: null,
    });
  });

  it("does not publish identical updates or change unrelated selector references", () => {
    const store = createBookingDraftStore();
    store.getState().activate(first);
    store.getState().changeRange(first, "space-a", range);
    const selectedRange = store.getState().range;
    store.getState().changeDraft(first, { title: "제목" });
    expect(store.getState().range).toBe(selectedRange);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.getState().activate(first);
    store.getState().changeDraft(first, { title: "제목" });
    store.getState().changeRange(first, "space-a", range);
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("publishes attendee-only changes and clears their touched state with booking content", () => {
    const store = createBookingDraftStore();
    store.getState().activate(first);
    store.getState().changeDraft(first, { actorId: "team" });
    const listener = vi.fn();
    store.subscribe(listener);
    store
      .getState()
      .changeDraft(first, { attendeeCount: 5, attendeeCountTouched: true });
    expect(listener).toHaveBeenCalledOnce();
    store
      .getState()
      .changeDraft(first, { attendeeCount: 5, attendeeCountTouched: true });
    expect(listener).toHaveBeenCalledOnce();
    store.getState().clearBookingContent(second);
    expect(store.getState().draft.attendeeCount).toBe(5);
    store.getState().clearBookingContent(first);
    expect(store.getState().draft).toEqual({
      title: "",
      actorId: "team",
      attendeeCount: null,
      attendeeCountTouched: false,
      participants: [],
    });
  });

  it("retains a manually emptied count until scope changes and resets count on another scope", () => {
    const store = createBookingDraftStore();
    store.getState().activate(first);
    store
      .getState()
      .changeDraft(first, { attendeeCount: null, attendeeCountTouched: true });
    expect(store.getState().draft.attendeeCountTouched).toBe(true);
    store.getState().activate(second);
    expect(store.getState().draft).toMatchObject({
      attendeeCount: null,
      attendeeCountTouched: false,
    });
  });

  it("shares seat/part selection for the same scope without publishing unrelated draft updates", () => {
    const store = createBookingDraftStore();
    store.getState().activate(first);
    store.getState().changeDraft(first, { title: "회의", actorId: "team" });
    const draft = store.getState().draft;
    store.getState().changeDeskPart(first, "pm");
    store.getState().changeDesk(first, "seat-1");
    const selected = store.getState();
    store.getState().activate(first);
    store.getState().changeDeskPart(first, "pm");
    store.getState().changeDesk(first, "seat-1");
    expect(store.getState()).toBe(selected);
    expect(store.getState().draft).toBe(draft);
    store.getState().changeDesk(first, null);
    expect(store.getState()).toMatchObject({
      deskPart: "pm",
      deskId: null,
      draft: { actorId: "team" },
    });
  });

  it("resets seats on a new scope and rejects stale selection/cleanup", () => {
    const store = createBookingDraftStore();
    store.getState().activate(first);
    store.getState().changeDeskPart(first, "day");
    store.getState().changeDesk(first, "seat-1");
    store.getState().activate(second);
    expect(store.getState()).toMatchObject({ deskPart: null, deskId: null });
    store.getState().changeDeskPart(second, "am");
    store.getState().changeDesk(second, "seat-2");
    const selected = store.getState();
    store.getState().changeDesk(first, null);
    store.getState().changeDeskPart(first, "pm");
    expect(store.getState()).toBe(selected);
  });

  it("keeps participants scope-bound and clears external proof on successful booking or scope change", () => {
    const store = createBookingDraftStore();
    const participants = [
      {
        userId: "guest",
        name: "김하은",
        sharedTeamNames: [],
        maskedEmail: "ha•••@floor.example",
        email: "haneul@floor.example",
      },
    ];
    store.getState().activate(first);
    store.getState().changeDraft(first, { participants, actorId: "team" });
    expect(store.getState().draft.participants).toBe(participants);
    store.getState().clearBookingContent(second);
    expect(store.getState().draft.participants).toBe(participants);
    store.getState().clearBookingContent(first);
    expect(store.getState().draft.participants).toEqual([]);
    expect(store.getState().draft.actorId).toBe("team");
    store.getState().changeDraft(first, { participants });
    store.getState().activate(second);
    expect(store.getState().draft.participants).toEqual([]);
    store.getState().changeDraft(first, { participants });
    expect(store.getState().draft.participants).toEqual([]);
  });
});
