// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  aggregatePresence,
  effectiveStatus,
  presenceSortGroup,
  STATUS_IDLE_MS,
  userStatusSchema,
} from "@/features/people/status";
import { createStatusActivity } from "@/features/people/status-activity";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("presence status without database status leakage", () => {
  it.each(["online", "away", "dnd"])("accepts selected %s", (status) => {
    expect(userStatusSchema.parse(status)).toBe(status);
  });
  it.each(["offline", "unknown", null, "ONLINE"])(
    "rejects persisted %s",
    (status) => {
      expect(userStatusSchema.safeParse(status).success).toBe(false);
    },
  );
  it("uses exact ten minute idle and hidden boundaries", () => {
    expect(effectiveStatus("online", 0, null, STATUS_IDLE_MS - 1)).toEqual({
      status: "online",
      auto: false,
    });
    expect(effectiveStatus("online", 0, null, STATUS_IDLE_MS)).toEqual({
      status: "away",
      auto: true,
    });
    expect(
      effectiveStatus("online", STATUS_IDLE_MS, 0, STATUS_IDLE_MS),
    ).toEqual({ status: "away", auto: true });
    expect(
      effectiveStatus("away", STATUS_IDLE_MS, null, STATUS_IDLE_MS),
    ).toEqual({ status: "away", auto: false });
    expect(effectiveStatus("dnd", 0, 0, STATUS_IDLE_MS)).toEqual({
      status: "dnd",
      auto: false,
    });
  });
  it("merges tabs by dnd, manual away, online, automatic away", () => {
    const values = [
      { status: "away", auto: true },
      { status: "online", auto: false },
      { status: "away", auto: false },
      { status: "dnd", auto: false },
    ];
    expect(aggregatePresence(values, true, true)).toBe("dnd");
    expect(aggregatePresence(values.slice(0, 3), true, true)).toBe("away");
    expect(aggregatePresence(values.slice(0, 2), true, true)).toBe("online");
    expect(aggregatePresence(values.slice(0, 1), true, true)).toBe("away");
    expect(aggregatePresence([...values].reverse(), true, true)).toBe("dnd");
  });
  it("does not call unsynchronized, disconnected, or nonshared people offline", () => {
    expect(aggregatePresence([], true, false)).toBe("unknown");
    expect(aggregatePresence([], false, true)).toBe("unknown");
    expect(aggregatePresence([], true, true)).toBe("offline");
    expect(
      aggregatePresence([{ typing: true, name: "사람" }], true, true),
    ).toBe("offline");
    expect(
      aggregatePresence(
        [{ status: "online", auto: false, extra: "not allowed" }],
        true,
        true,
      ),
    ).toBe("offline");
  });
  it("groups all present statuses before offline and unknown", () => {
    expect(
      ["online", "away", "dnd", "offline", "unknown"].map((s) =>
        presenceSortGroup(s as Parameters<typeof presenceSortGroup>[0]),
      ),
    ).toEqual([0, 0, 0, 1, 2]);
  });
});

describe("effect-owned activity clock", () => {
  it("retains the latest automatic change during the minute throttle", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const publish = vi.fn();
    const activity = createStatusActivity({ selected: "online", publish });
    expect(publish).toHaveBeenLastCalledWith({ status: "online", auto: false });
    vi.advanceTimersByTime(STATUS_IDLE_MS);
    expect(publish).toHaveBeenLastCalledWith({ status: "away", auto: true });
    window.dispatchEvent(new Event("keydown"));
    expect(publish).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(59_999);
    expect(publish).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(1);
    expect(publish).toHaveBeenLastCalledWith({ status: "online", auto: false });
    activity.close();
  });
  it("manual status changes publish immediately without losing the latest automatic value", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const publish = vi.fn();
    const activity = createStatusActivity({ selected: "online", publish });
    activity.setSelected("dnd");
    activity.setSelected("away");
    expect(publish.mock.calls.map(([data]) => data)).toEqual([
      { status: "online", auto: false },
      { status: "dnd", auto: false },
      { status: "away", auto: false },
    ]);
    vi.advanceTimersByTime(STATUS_IDLE_MS);
    expect(publish).toHaveBeenCalledTimes(3);
    activity.setSelected("online");
    expect(publish).toHaveBeenLastCalledWith({ status: "away", auto: true });
    activity.close();
  });
  it("hidden time cannot be extended by incidental input and close clears timers", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    const publish = vi.fn();
    const activity = createStatusActivity({ selected: "online", publish });
    visibility.mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(STATUS_IDLE_MS - 1);
    window.dispatchEvent(new Event("pointermove"));
    vi.advanceTimersByTime(1);
    expect(publish).toHaveBeenLastCalledWith({ status: "away", auto: true });
    activity.close();
    const calls = publish.mock.calls.length;
    window.dispatchEvent(new Event("keydown"));
    vi.advanceTimersByTime(STATUS_IDLE_MS);
    expect(publish).toHaveBeenCalledTimes(calls);
    expect(vi.getTimerCount()).toBe(0);
  });
});
