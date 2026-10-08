import { render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNotificationSummary } from "@/features/notifications/client";
import { NotificationRow } from "@/features/notifications/components/notification-list";
import { useNotificationToasts } from "@/features/notifications/components/use-notification-toasts";
import {
  notificationHref,
  notificationPresentation,
} from "@/features/notifications/format";
import {
  parseNotificationData,
  type NotificationItem,
  type NotificationSummary,
} from "@/features/notifications/types";

const mock = vi.hoisted(() => ({ toast: vi.fn(), push: vi.fn() }));
vi.mock("sonner", () => ({ toast: mock.toast }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mock.push }) }));
const base = {
  id: "friend",
  read: false,
  scheduledFor: "2026-10-08T15:02:00Z",
  bookingId: null,
  data: { actorName: "김하은" },
};
const now = "2026-10-08T15:05:00Z";
const request: NotificationItem = {
  ...base,
  type: "friend_request",
  href: "/friends?tab=received",
};
const summary = (items: NotificationItem[], at = now): NotificationSummary => ({
  items,
  now: at,
  unreadCount: items.length,
  nextAt: null,
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("person notification snapshots and presentation", () => {
  it.each(["friend_request", "friend_accepted", "message_request"] as const)(
    "parses only the strict actor snapshot for %s",
    (type) => {
      expect(parseNotificationData(type, base.data)).toEqual(base.data);
      for (const invalid of [
        {},
        { actorName: "" },
        { actorName: null },
        { ...base.data, email: "private@example.test" },
        { ...base.data, actorId: "private" },
        { ...base.data, start: now },
      ]) {
        expect(parseNotificationData(type, invalid)).toBeNull();
      }
      expect(parseNotificationData("booking_invited", base.data)).toBeNull();
    },
  );

  it.each([
    [
      "friend_request",
      "김하은 님이 친구 요청을 보냈어요",
      "/friends?tab=received",
    ],
    ["friend_accepted", "김하은 님이 친구 요청을 수락했어요", "/friends"],
    [
      "message_request",
      "김하은 님이 메시지를 보내고 싶어 해요",
      "/friends?tab=requests",
    ],
  ] as const)(
    "renders %s without a booking date or separator",
    (type, text, href) => {
      const item: NotificationItem = { ...base, type, href };
      expect(notificationHref(item)).toBe(href);
      expect(notificationPresentation(item)).toMatchObject({
        text,
        dateTime: undefined,
      });
      render(<NotificationRow item={item} now={now} onActivate={vi.fn()} />);
      const row = screen.getByRole("link");
      expect(row).toHaveAttribute("href", href);
      expect(row).toHaveAccessibleName(`읽지 않음 · ${text} · 3분 전`);
      expect(row.querySelector("time")?.parentElement?.textContent).toBe(
        "3분 전",
      );
    },
  );

  it("uses Seoul's day boundary rather than the browser timezone", () => {
    render(
      <NotificationRow
        item={{ ...request, scheduledFor: "2026-10-08T14:00:00Z" }}
        now={now}
        onActivate={vi.fn()}
      />,
    );
    expect(screen.getByText("어제")).toBeVisible();
  });

  it("accepts person snapshots from the recurring GET and rejects extra sensitive fields", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(summary([request]))));
    vi.stubGlobal("fetch", fetch);
    await expect(
      fetchNotificationSummary(new AbortController().signal),
    ).resolves.toEqual(summary([request]));
    fetch.mockResolvedValue(
      new Response(
        JSON.stringify(
          summary([
            {
              ...request,
              data: { ...base.data, email: "private@example.test" },
            } as NotificationItem,
          ]),
        ),
      ),
    );
    await expect(
      fetchNotificationSummary(new AbortController().signal),
    ).rejects.toMatchObject({ status: 500 });
  });

  it("skips initial toasts and omits the description for newly published people alerts", () => {
    const activate = vi.fn().mockResolvedValue(true);
    const { rerender } = renderHook(
      ({ data }) => useNotificationToasts(data, activate),
      { initialProps: { data: summary([], "2026-10-08T15:01:00Z") } },
    );
    expect(mock.toast).not.toHaveBeenCalled();
    rerender({ data: summary([request]) });
    expect(mock.toast).toHaveBeenCalledExactlyOnceWith(
      "김하은 님이 친구 요청을 보냈어요",
      expect.objectContaining({ id: "friend" }),
    );
    expect(mock.toast.mock.calls[0]![1]).not.toHaveProperty("description");
    mock.toast.mock.calls[0]![1].action.onClick();
    expect(activate).toHaveBeenCalledWith(request);
  });
});
