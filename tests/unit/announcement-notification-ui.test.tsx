import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MatchMedia } from "@/features/bookings/components/use-wide-screen";
import { NotificationBell } from "@/features/notifications/components/notification-bell";
import {
  NotificationList,
  NotificationRow,
} from "@/features/notifications/components/notification-list";
import { NotificationsFeed } from "@/features/notifications/components/notifications-feed";
import {
  NOTIFICATION_LIST_KEY,
  NOTIFICATION_SUMMARY_KEY,
} from "@/features/notifications/components/use-notifications";
import type {
  NotificationItem,
  NotificationListData,
  NotificationSummary,
} from "@/features/notifications/types";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  one: vi.fn(),
  all: vi.fn(),
  error: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));
vi.mock("@/features/notifications/actions", () => ({
  markNotificationRead: mocks.one,
  markAllNotificationsRead: mocks.all,
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { error: mocks.error }),
}));
const now = "2026-10-09T03:00:00Z";
const notice: Extract<NotificationItem, { type: "branch_announcement" }> = {
  id: "notice",
  type: "branch_announcement",
  bookingId: null,
  href: null,
  actorAvatar: { color: "pink", photoUrl: null },
  read: false,
  scheduledFor: "2026-10-09T02:55:00Z",
  data: {
    branchName: "강남점",
    title: "7층 정전 안내",
    body: "7층은 8시부터 이용해 주세요.\n6층 라운지는 평소대로 열어요.",
    announcementId: "a1000000-0000-4000-8000-000000000001",
  },
};
const initial: NotificationSummary = {
  items: [notice],
  unreadCount: 12,
  now,
  nextAt: null,
};
const media: MatchMedia = () => ({
  matches: true,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});
const clients: QueryClient[] = [];
type ReadResult =
  { ok: true; data: Record<string, never> } | { ok: false; code: "INTERNAL" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.one.mockResolvedValue({ ok: true, data: {} });
  mocks.all.mockResolvedValue({ ok: true, data: {} });
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
});
function display(page = false) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  clients.push(client);
  client.setQueryData(NOTIFICATION_LIST_KEY, initial);
  const frame = (data = initial) => (
    <QueryClientProvider client={client}>
      <NotificationBell
        initialData={data}
        matchMedia={media}
        fetchSummary={async () =>
          client.getQueryData<NotificationSummary>(NOTIFICATION_SUMMARY_KEY) ??
          data
        }
      />
      {page && (
        <section aria-label="알림 페이지">
          <NotificationsFeed initialData={data} />
        </section>
      )}
    </QueryClientProvider>
  );
  return { ...render(frame()), client, frame };
}

describe("branch announcement notification row", () => {
  it("starts collapsed with a megaphone and expands its snapshot after one activation", async () => {
    const onActivate = vi.fn();
    const { container } = render(
      <NotificationRow item={notice} now={now} onActivate={onActivate} />,
    );
    const button = screen.getByRole("button", {
      name: "읽지 않음 · 강남점 공지 · 7층 정전 안내 · 5분 전",
    });
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveClass("min-h-11");
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(container.querySelector("svg.lucide-megaphone")).toBeInTheDocument();
    expect(
      container.querySelector("[data-user-avatar]"),
    ).not.toBeInTheDocument();
    await userEvent.click(button);
    expect(onActivate).toHaveBeenCalledOnce();
    expect(onActivate.mock.calls[0]?.[0]).toBe(notice);
    const region = screen.getByRole("region", { name: "강남점 공지 내용" });
    expect(button).toHaveAttribute("aria-controls", region.id);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(region.textContent).toBe(notice.data.body);
    expect(region).toHaveClass("whitespace-pre-wrap");
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
  it("supports Enter and Space without losing focus", async () => {
    const user = userEvent.setup();
    const onActivate = vi.fn();
    render(<NotificationRow item={notice} now={now} onActivate={onActivate} />);
    await user.tab();
    const button = screen.getByRole("button");
    expect(button).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(button).toHaveAttribute("aria-expanded", "true");
    await user.keyboard(" ");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveFocus();
    expect(onActivate).toHaveBeenCalledTimes(2);
  });
  it("prevents pending activation without opening or collapsing the row", () => {
    const onActivate = vi.fn();
    const view = (pending: boolean) => (
      <NotificationRow
        item={notice}
        now={now}
        onActivate={onActivate}
        pending={pending}
      />
    );
    const { rerender } = render(view(true));
    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(onActivate).not.toHaveBeenCalled();
    rerender(view(false));
    fireEvent.click(button);
    rerender(view(true));
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(onActivate).toHaveBeenCalledOnce();
  });
  it("renders HTML and mention syntax as inert text without parsing tags or links", async () => {
    const body =
      '<img src=x onerror="alert(1)">\n<script>alert(2)</script>\n<@everyone> https://example.test';
    render(
      <NotificationRow
        item={{ ...notice, data: { ...notice.data, body } }}
        now={now}
        onActivate={vi.fn()}
      />,
    );
    await userEvent.click(screen.getByRole("button"));
    const region = screen.getByRole("region");
    expect(region.textContent).toBe(body);
    expect(region.querySelector("img,script,a")).toBeNull();
  });
  it("keeps distinct disclosure IDs, focused DOM and the stored text when read state changes", async () => {
    const other = {
      ...notice,
      id: "other",
      data: {
        ...notice.data,
        title: "2층 안내",
        announcementId: "a1000000-0000-4000-8000-000000000002",
      },
    };
    const view = (read: boolean) => (
      <NotificationList
        items={[{ ...notice, read }, other]}
        now={now}
        onActivate={vi.fn()}
      />
    );
    const { rerender } = render(view(false));
    const first = screen.getByRole("button", { name: /7층 정전/ });
    const second = screen.getByRole("button", { name: /2층 안내/ });
    expect(first.getAttribute("aria-controls")).not.toBe(
      second.getAttribute("aria-controls"),
    );
    await userEvent.click(first);
    rerender(view(true));
    expect(screen.getByRole("button", { name: /7층 정전/ })).toBe(first);
    expect(first).toHaveFocus();
    expect(first).toHaveAttribute("aria-expanded", "true");
    expect(first).not.toHaveAccessibleName(
      expect.stringContaining("읽지 않음"),
    );
    expect(screen.getByRole("region").textContent).toBe(notice.data.body);
    expect(second).toHaveAccessibleName(expect.stringContaining("읽지 않음"));
  });
});

describe("announcement disclosure in the real notification consumers", () => {
  it("updates the badge optimistically and keeps the popover open without navigation", async () => {
    const result = deferred<ReadResult>();
    mocks.one.mockReturnValue(result.promise);
    const { client } = display();
    const bell = screen.getByRole("button", {
      name: "알림, 읽지 않은 알림 12개",
    });
    expect(bell).toHaveTextContent("9+");
    await userEvent.click(bell);
    const dialog = screen.getByRole("dialog", { name: "알림" });
    const row = within(dialog).getByRole("button", { name: /7층 정전/ });
    await userEvent.click(row);
    expect(within(dialog).getByRole("region").textContent).toBe(
      notice.data.body,
    );
    await screen.findByRole("button", { name: "알림, 읽지 않은 알림 11개" });
    expect(bell).toHaveTextContent("9+");
    expect(row).toBeDisabled();
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(mocks.one).toHaveBeenCalledExactlyOnceWith({
      notificationId: notice.id,
    });
    expect(
      client.getQueryData<NotificationListData>(NOTIFICATION_LIST_KEY)?.items[0]
        ?.read,
    ).toBe(true);
    await act(async () => result.resolve({ ok: true, data: {} }));
    await waitFor(() => expect(row).toBeEnabled());
    expect(screen.getByRole("dialog", { name: "알림" })).toBe(dialog);
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    await userEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("dialog", { name: "알림" })).toBe(dialog);
  });
  it("rolls back both caches and exposes only the fixed failure message while preserving disclosure", async () => {
    const result = deferred<ReadResult>();
    mocks.one.mockReturnValue(result.promise);
    const { client } = display();
    await userEvent.click(
      screen.getByRole("button", { name: /알림, 읽지 않은/ }),
    );
    const dialog = screen.getByRole("dialog", { name: "알림" });
    const row = within(dialog).getByRole("button", { name: /7층 정전/ });
    await userEvent.click(row);
    await screen.findByRole("button", { name: "알림, 읽지 않은 알림 11개" });
    await act(async () => result.resolve({ ok: false, code: "INTERNAL" }));
    expect(await within(dialog).findByRole("status")).toHaveTextContent(
      "알림을 읽음으로 바꾸지 못했어요. 다시 시도해 주세요",
    );
    await screen.findByRole("button", { name: "알림, 읽지 않은 알림 12개" });
    for (const key of [NOTIFICATION_SUMMARY_KEY, NOTIFICATION_LIST_KEY]) {
      expect(
        client.getQueryData<NotificationListData>(key)?.items[0]?.read,
      ).toBe(false);
      expect(client.getQueryData<NotificationListData>(key)?.unreadCount).toBe(
        12,
      );
    }
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(row).toHaveAccessibleName(expect.stringContaining("읽지 않음"));
    expect(row).toBeEnabled();
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it("uses the same disclosure on the full page and preserves it across a successful refresh", async () => {
    const { rerender, frame } = display(true);
    const page = screen.getByRole("region", { name: "알림 페이지" });
    const row = within(page).getByRole("button", { name: /7층 정전/ });
    await userEvent.click(row);
    expect(
      within(page).getByRole("region", { name: "강남점 공지 내용" })
        .textContent,
    ).toBe(notice.data.body);
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    rerender(
      frame({
        ...initial,
        now: "2026-10-09T03:01:00Z",
        unreadCount: 11,
        items: [{ ...notice, read: true }],
      }),
    );
    expect(within(page).getByRole("button", { name: /7층 정전/ })).toBe(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(mocks.one).toHaveBeenCalledExactlyOnceWith({
      notificationId: notice.id,
    });
    expect(mocks.push).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
