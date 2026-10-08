import { StrictMode, type ReactNode } from "react";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useNotificationSummary,
  useNotificationReads,
  useNotificationList,
  NOTIFICATION_SUMMARY_KEY,
} from "@/features/notifications/components/use-notifications";
import { useNotificationToasts } from "@/features/notifications/components/use-notification-toasts";
import { useNotificationActivity } from "@/features/notifications/components/use-notification-activity";
import type { FetchNotificationSummary } from "@/features/notifications/client";
import type {
  NotificationItem,
  NotificationSummary,
} from "@/features/notifications/types";

const mocked = vi.hoisted(() => ({
  toast: vi.fn(),
  error: vi.fn(),
  one: vi.fn(),
  all: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(mocked.toast, { error: mocked.error }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocked.push, refresh: mocked.refresh }),
}));
vi.mock("@/features/notifications/actions", () => ({
  markNotificationRead: mocked.one,
  markAllNotificationsRead: mocked.all,
}));
const item: NotificationItem = {
  id: "first",
  type: "booking_invited",
  read: false,
  scheduledFor: "2026-10-08T05:50:00Z",
  bookingId: "booking",
  href: "/bookings?view=calendar",
  data: {
    actorName: "이서연",
    spaceName: "회의실 C",
    branchName: "강남점",
    floorName: "7F",
    timezone: "Asia/Seoul",
    start: "2026-10-08T06:00:00Z",
    end: "2026-10-08T07:00:00Z",
    title: "보안 검토",
  },
};
const initial: NotificationSummary = {
  items: [item],
  unreadCount: 1,
  now: "2026-10-08T05:55:00Z",
  nextAt: null,
};
const freshItem = { ...item, id: "new", scheduledFor: "2026-10-08T05:55:30Z" };
const fresh: NotificationSummary = {
  items: [freshItem, item],
  unreadCount: 2,
  now: "2026-10-08T05:56:00Z",
  nextAt: null,
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2035-01-01T00:00:00Z"));
  vi.clearAllMocks();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  focusManager.setFocused(true);
  mocked.one.mockResolvedValue({ ok: true, data: {} });
  mocked.all.mockResolvedValue({ ok: true, data: {} });
});
afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});
async function advance(ms = 0) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
function setup({
  data = initial,
  fetchSummary = vi.fn<FetchNotificationSummary>().mockResolvedValue(fresh),
  strict = false,
}: {
  data?: NotificationSummary;
  fetchSummary?: FetchNotificationSummary;
  strict?: boolean;
} = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 60_000 } },
  });
  function Frame({ children }: { children: ReactNode }) {
    const content = (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    return strict ? <StrictMode>{content}</StrictMode> : content;
  }
  const hook = renderHook(
    ({ incoming }) => {
      const data = useNotificationSummary(incoming, fetchSummary);
      const reads = useNotificationReads();
      const list = useNotificationList(incoming);
      useNotificationToasts(data, reads.activate);
      return { data, list, ...reads };
    },
    { initialProps: { incoming: data }, wrapper: Frame },
  );
  return { ...hook, client, fetchSummary };
}
function visibility(value: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("live notification queries", () => {
  it("keeps SSR data without a mount request, polls at 60s and never toasts the first response", async () => {
    const { result, fetchSummary } = setup();
    expect(result.current.data).toEqual(initial);
    expect(mocked.toast).not.toHaveBeenCalled();
    await advance(59_999);
    expect(fetchSummary).not.toHaveBeenCalled();
    await advance(2);
    expect(fetchSummary).toHaveBeenCalledOnce();
    expect(result.current.data).toEqual(fresh);
    expect(mocked.toast).toHaveBeenCalledExactlyOnceWith(
      "이서연 님이 회의실 C 예약에 초대했어요",
      expect.objectContaining({
        id: "new",
        description: "10월 8일 목 15:00–16:00",
      }),
    );
    expect(mocked.toast.mock.calls[0]![1].description).not.toMatch(
      /강남|7F|보안/,
    );
  });
  it("uses nextAt relative to the server clock, cleans old timers on new props, and cancels on unmount", async () => {
    const { fetchSummary, rerender, unmount } = setup({
      data: { ...initial, nextAt: "2026-10-08T05:55:30Z" },
    });
    await advance(15_000);
    rerender({
      incoming: {
        ...initial,
        now: "2026-10-08T05:55:15Z",
        nextAt: "2026-10-08T05:55:55Z",
      },
    });
    await advance(16_000);
    expect(fetchSummary).not.toHaveBeenCalled();
    await advance(25_000);
    expect(fetchSummary).toHaveBeenCalledOnce();
    unmount();
    await advance(120_000);
    expect(fetchSummary).toHaveBeenCalledOnce();
  });
  it("pauses periodic and reminder requests while hidden and refetches on return despite fresh data", async () => {
    const { fetchSummary } = setup({
      data: { ...initial, nextAt: "2026-10-08T05:55:30Z" },
    });
    act(() => visibility("hidden"));
    await advance(120_000);
    expect(fetchSummary).not.toHaveBeenCalled();
    act(() => visibility("visible"));
    await advance(1);
    expect(fetchSummary).toHaveBeenCalledOnce();
    await advance(1_000);
    act(() => window.dispatchEvent(new Event("focus")));
    await advance(1);
    expect(fetchSummary).toHaveBeenCalledTimes(2);
  });
  it("pauses after ten idle minutes and resumes immediately on the next input", async () => {
    const { fetchSummary } = setup();
    await advance(10 * 60_000 + 1);
    const count = vi.mocked(fetchSummary).mock.calls.length;
    expect(count).toBeGreaterThan(0);
    await advance(5 * 60_000);
    expect(fetchSummary).toHaveBeenCalledTimes(count);
    act(() =>
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" })),
    );
    await advance(1);
    expect(fetchSummary).toHaveBeenCalledTimes(count + 1);
  });
  it("ignores an older in-flight response after newer server props and accepts newer props only once in StrictMode", async () => {
    let resolve!: (data: NotificationSummary) => void;
    const fetchSummary = vi.fn<FetchNotificationSummary>(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const { result, rerender } = setup({ fetchSummary, strict: true });
    await advance(60_000);
    rerender({ incoming: fresh });
    await advance(1);
    expect(mocked.toast).toHaveBeenCalledOnce();
    await act(async () => resolve({ ...initial, now: "2026-10-08T05:55:15Z" }));
    await advance(1);
    expect(result.current.data).toEqual(fresh);
    rerender({ incoming: initial });
    await advance(1);
    expect(result.current.data).toEqual(fresh);
    expect(mocked.toast).toHaveBeenCalledOnce();
  });
  it("aborts a poll before reading and restores only its optimistic read over the newest SSR snapshot on failure", async () => {
    const requests: AbortSignal[] = [];
    const fetchSummary = vi.fn<FetchNotificationSummary>((signal) => {
      requests.push(signal);
      return new Promise(() => {});
    });
    let resolve!: (data: { ok: false; code: string }) => void;
    mocked.one.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result, rerender, client } = setup({ fetchSummary });
    await advance(60_000);
    act(() => {
      void result.current.activate(item);
    });
    await advance(1);
    expect(requests[0]!.aborted).toBe(true);
    expect(result.current.data.unreadCount).toBe(0);
    rerender({ incoming: fresh });
    await advance(1);
    expect(result.current.data.unreadCount).toBe(1);
    expect(
      result.current.data.items.find((row) => row.id === item.id)!.read,
    ).toBe(true);
    await act(async () => resolve({ ok: false, code: "INTERNAL_ERROR" }));
    await advance(1);
    expect(result.current.data).toEqual(fresh);
    expect(client.getQueryData(NOTIFICATION_SUMMARY_KEY)).toEqual(fresh);
    expect(mocked.error).toHaveBeenCalledOnce();
    expect(mocked.push).not.toHaveBeenCalled();
  });
  it("shows one toast per new notification up to three, then a single summary for four", async () => {
    const { rerender } = setup();
    const three = Array.from({ length: 3 }, (_, index) => ({
      ...freshItem,
      id: `new-${index}`,
    }));
    rerender({
      incoming: {
        ...fresh,
        items: [
          ...three,
          { ...item, id: "old-returned-to-latest20" },
          { ...freshItem, id: "already-read", read: true },
        ],
      },
    });
    await advance(1);
    expect(mocked.toast).toHaveBeenCalledTimes(3);
    const four = Array.from({ length: 4 }, (_, index) => ({
      ...freshItem,
      id: `next-${index}`,
      scheduledFor: "2026-10-08T05:56:10Z",
    }));
    rerender({
      incoming: { ...fresh, now: "2026-10-08T05:57:00Z", items: four },
    });
    await advance(1);
    expect(mocked.toast).toHaveBeenCalledTimes(4);
    expect(mocked.toast).toHaveBeenLastCalledWith(
      "새 알림 4개",
      expect.objectContaining({
        action: expect.objectContaining({ label: "보기" }),
      }),
    );
    mocked.toast.mock.calls[3]![1].action.onClick();
    expect(mocked.push).toHaveBeenCalledWith("/notifications");
  });
  it("reuses one reminder toast ID and the View action marks read before navigating", async () => {
    const { rerender } = setup({ fetchSummary: async () => fresh });
    const reminder: NotificationItem = {
      ...freshItem,
      type: "booking_reminder",
      data: {
        spaceName: "회의실 C",
        branchName: "강남점",
        floorName: "7F",
        timezone: "Asia/Seoul",
        start: "2026-10-08T06:00:00Z",
        end: "2026-10-08T07:00:00Z",
        minutesBefore: 5,
      },
    };
    rerender({ incoming: { ...fresh, items: [reminder] } });
    await advance(1);
    rerender({
      incoming: {
        ...fresh,
        now: "2026-10-08T06:00:00Z",
        items: [
          {
            ...reminder,
            id: "started",
            scheduledFor: "2026-10-08T06:00:00Z",
            data: { ...reminder.data, minutesBefore: 0 },
          },
        ],
      },
    });
    await advance(1);
    expect(mocked.toast.mock.calls.map((call) => call[1].id)).toEqual([
      "reminder:booking",
      "reminder:booking",
    ]);
    act(() => mocked.toast.mock.calls[1]![1].action.onClick());
    await advance(1);
    expect(mocked.one).toHaveBeenCalledWith({ notificationId: "started" });
    expect(mocked.push).toHaveBeenCalledWith(reminder.href);
  });
  it("retains server data after a poll failure and rolls back all-read on failure", async () => {
    const fetchSummary = vi
      .fn<FetchNotificationSummary>()
      .mockRejectedValue(new Error("private@example.com"));
    mocked.all.mockResolvedValue({ ok: false, code: "INTERNAL_ERROR" });
    const { result } = setup({ fetchSummary });
    await advance(60_000);
    expect(result.current.data).toEqual(initial);
    expect(mocked.toast).not.toHaveBeenCalled();
    act(() => {
      void result.current.markAll();
    });
    await advance(1);
    expect(result.current.data).toEqual(initial);
    expect(result.current.message).not.toContain("private@example.com");
    expect(mocked.error).toHaveBeenCalledOnce();
  });
  it("keeps a newly-published row unread in both caches when an earlier all-read finishes later", async () => {
    let resolve!: (value: { ok: true; data: Record<string, never> }) => void;
    mocked.all.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const latest = {
      ...fresh,
      unreadCount: 1,
      items: [freshItem, { ...item, read: true }],
    };
    const { result, rerender } = setup({ fetchSummary: async () => latest });
    act(() => {
      void result.current.markAll();
    });
    await advance(1);
    expect(result.current.data.unreadCount).toBe(0);
    rerender({ incoming: latest });
    await advance(1);
    expect(result.current.data.unreadCount).toBe(1);
    expect(result.current.list.items[0]!.read).toBe(false);
    await act(async () => resolve({ ok: true, data: {} }));
    await advance(1);
    expect(result.current.data).toEqual(latest);
    expect(result.current.list).toEqual(latest);
    expect(mocked.refresh).toHaveBeenCalledOnce();
  });
  it("does not read the next reminder stage published while an earlier stage is being read", async () => {
    const first: NotificationItem = {
      ...item,
      type: "booking_reminder",
      data: {
        ...item.data,
        actorName: undefined,
        title: undefined,
        minutesBefore: 10,
      },
    };
    const next = {
      ...first,
      id: "five-minutes",
      scheduledFor: "2026-10-08T05:55:30Z",
      data: { ...first.data, minutesBefore: 5 as const },
    };
    const latest = { ...fresh, items: [next], unreadCount: 1 };
    let resolve!: (value: { ok: true; data: Record<string, never> }) => void;
    mocked.one.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result, rerender } = setup({
      data: { ...initial, items: [first] },
      fetchSummary: async () => latest,
    });
    act(() => {
      void result.current.activate(first);
    });
    await advance(1);
    rerender({ incoming: latest });
    await advance(1);
    expect(result.current.data.unreadCount).toBe(1);
    expect(result.current.list.items[0]!.read).toBe(false);
    await act(async () => resolve({ ok: true, data: {} }));
    await advance(1);
    expect(result.current.data).toEqual(latest);
    expect(result.current.list).toEqual(latest);
  });
});

describe("notification activity", () => {
  it("pointer input resets idle time and an initially hidden tab stays inactive until visible", async () => {
    visibility("hidden");
    const { result } = renderHook(useNotificationActivity);
    expect(result.current.active).toBe(false);
    act(() => document.dispatchEvent(new Event("pointermove")));
    expect(result.current.active).toBe(false);
    act(() => visibility("visible"));
    expect(result.current.active).toBe(true);
    await advance(9 * 60_000);
    act(() => document.dispatchEvent(new Event("pointerdown")));
    await advance(9 * 60_000);
    expect(result.current.active).toBe(true);
    await advance(60_000);
    expect(result.current.active).toBe(false);
  });
});
