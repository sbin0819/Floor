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
      draft: { title: "", actorId: null },
      range: null,
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
    store.getState().clearTitle(first);
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
    store.getState().clearTitle(first);
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
});
