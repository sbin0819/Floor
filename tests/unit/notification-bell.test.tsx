import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import { NotificationsFeed } from "@/features/notifications/components/notifications-feed";
import { NOTIFICATION_SUMMARY_KEY } from "@/features/notifications/components/use-notifications";
import type { NotificationSummary } from "@/features/notifications/types";
import type { MatchMedia } from "@/features/bookings/components/use-wide-screen";

const mocked = vi.hoisted(() => ({
  push: vi.fn(),
  one: vi.fn(),
  all: vi.fn(),
  error: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocked.push }),
}));
vi.mock("@/features/notifications/actions", () => ({
  markNotificationRead: mocked.one,
  markAllNotificationsRead: mocked.all,
}));
vi.mock("sonner", () => ({ toast: { error: mocked.error } }));
const initial: NotificationSummary = {
  now: "2026-10-08T05:55:00Z",
  nextAt: null,
  unreadCount: 3,
  items: [
    {
      id: "first",
      bookingId: "booking",
      type: "booking_invited",
      read: false,
      scheduledFor: "2026-10-08T05:50:00Z",
      href: "/bookings?view=calendar",
      data: {
        actorName: "이서연",
        spaceName: "회의실 C",
        floorName: "7F",
        branchName: "강남점",
        timezone: "Asia/Seoul",
        start: "2026-10-08T06:00:00Z",
        end: "2026-10-08T07:00:00Z",
      },
    },
  ],
};
const media =
  (wide: boolean): MatchMedia =>
  () => ({
    matches: wide,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocked.one.mockResolvedValue({ ok: true, data: {} });
  mocked.all.mockResolvedValue({ ok: true, data: {} });
});
function display(data = initial, wide = true, page = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const matchMedia = media(wide);
  const frame = (incoming: NotificationSummary) => (
    <QueryClientProvider client={client}>
      <NotificationBell initialData={incoming} matchMedia={matchMedia} />
      {page && <NotificationsFeed initialData={incoming} />}
    </QueryClientProvider>
  );
  return {
    ...render(frame(data)),
    client,
    update: (incoming: NotificationSummary) => frame(incoming),
  };
}
describe("notification bell and shared read state", () => {
  it.each([0, 3, 12])(
    "announces the true unread count %s and caps only the visual badge",
    async (count) => {
      display({
        ...initial,
        unreadCount: count,
        items: count ? initial.items : [],
      });
      const bell = screen.getByRole("button", {
        name: count ? `알림, 읽지 않은 알림 ${count}개` : "알림",
      });
      expect(bell).toHaveTextContent(
        count ? (count > 9 ? "9+" : String(count)) : "",
      );
      await userEvent.click(bell);
      const dialog = screen.getByRole("dialog", { name: "알림" });
      expect(dialog).toHaveClass("w-[392px]");
      expect(
        within(dialog)
          .getByRole("button", { name: "모두 읽음" })
          .hasAttribute("disabled"),
      ).toBe(count === 0);
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(bell).toHaveFocus());
    },
  );
  it("uses a normal all-notifications link below 768px without mounting a popover", () => {
    display(initial, false);
    expect(
      screen.getByRole("link", { name: "알림, 읽지 않은 알림 3개" }),
    ).toHaveAttribute("href", "/notifications");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("optimistically changes page and bell state, prevents parallel submits, then navigates after success", async () => {
    let finish!: (result: { ok: true; data: Record<string, never> }) => void;
    mocked.one.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    display(initial, true, true);
    const row = screen.getByRole("link", { name: /읽지 않음 · 이서연/ });
    fireEvent.click(row);
    fireEvent.click(row);
    await screen.findByRole("button", { name: "알림, 읽지 않은 알림 2개" });
    expect(
      screen.queryByRole("link", { name: /읽지 않음 · 이서연/ }),
    ).not.toBeInTheDocument();
    expect(mocked.one).toHaveBeenCalledExactlyOnceWith({
      notificationId: "first",
    });
    expect(mocked.push).not.toHaveBeenCalled();
    await act(async () => finish({ ok: true, data: {} }));
    await waitFor(() =>
      expect(mocked.push).toHaveBeenCalledWith(initial.items[0]!.href),
    );
  });
  it("rolls back both caches and announces a safe error without navigation", async () => {
    mocked.one.mockResolvedValue({ ok: false, code: "INTERNAL_ERROR" });
    display(initial, true, true);
    await userEvent.click(screen.getByRole("link", { name: /이서연/ }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "알림을 읽음으로 바꾸지 못했어요",
    );
    expect(
      screen.getByRole("button", { name: "알림, 읽지 않은 알림 3개" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /읽지 않음 · 이서연/ }),
    ).toBeInTheDocument();
    expect(mocked.error).toHaveBeenCalledOnce();
    expect(mocked.push).not.toHaveBeenCalled();
  });
  it("marks all once across consumers and updates the bell count", async () => {
    display(initial, true, true);
    await userEvent.click(screen.getByRole("button", { name: "모두 읽음" }));
    await screen.findByRole("button", { name: "알림" });
    expect(mocked.all).toHaveBeenCalledWith();
    expect(screen.getByRole("button", { name: "모두 읽음" })).toBeDisabled();
  });
  it("preserves modified anchor clicks without marking rows or routing", () => {
    display(initial, true, true);
    const row = screen.getByRole("link", { name: /이서연/ });
    expect(fireEvent.click(row, { ctrlKey: true })).toBe(true);
    expect(mocked.one).not.toHaveBeenCalled();
    expect(mocked.push).not.toHaveBeenCalled();
  });
  it("accepts newer server props and ignores an older preserved response", async () => {
    const { rerender, update, client } = display();
    const fresh = { ...initial, unreadCount: 12, now: "2026-10-08T05:56:00Z" };
    rerender(update(fresh));
    await screen.findByRole("button", { name: "알림, 읽지 않은 알림 12개" });
    rerender(update(initial));
    expect(client.getQueryData(NOTIFICATION_SUMMARY_KEY)).toEqual(fresh);
  });
});
