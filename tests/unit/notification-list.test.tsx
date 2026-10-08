import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import {
  NotificationList,
  NotificationRow,
} from "@/features/notifications/components/notification-list";
import { NotificationListSkeleton } from "@/features/notifications/components/notification-list-skeleton";
import { notificationHref } from "@/features/notifications/format";
import type {
  NotificationItem,
  NotificationType,
} from "@/features/notifications/types";

const now = "2026-10-08T05:55:00Z";
function notification(
  type: NotificationType = "booking_invited",
): NotificationItem {
  const item = {
    id: type,
    type,
    read: false,
    scheduledFor: "2026-10-08T05:50:00Z",
    bookingId: "booking",
    data: {
      actorName: type === "booking_reminder" ? undefined : "박지훈",
      spaceName: "회의실 C",
      floorName: "7F",
      branchName: "강남점",
      timezone: "Asia/Seoul",
      start: "2026-10-08T06:00:00Z",
      end: "2026-10-08T07:00:00Z",
      title: type === "booking_reminder" ? undefined : "주간 회의",
      ...(type === "booking_reminder" ? { minutesBefore: 5 as const } : {}),
      ...(type === "booking_changed"
        ? {
            previousStart: "2026-10-08T05:00:00Z",
            previousEnd: "2026-10-08T06:00:00Z",
          }
        : {}),
    },
  };
  return { ...item, href: notificationHref(item) };
}

describe("shared notification rows", () => {
  it.each([
    ["booking_invited", "박지훈 님이 회의실 C 예약에 초대했어요"],
    ["booking_changed", "박지훈 님이 회의실 C 예약의 시간을 바꿨어요"],
    ["booking_cancelled", "박지훈 님이 회의실 C 예약을 취소했어요"],
    ["booking_removed", "박지훈 님이 회의실 C 예약의 참석자에서 뺐어요"],
    ["participant_left", "박지훈 님이 회의실 C 예약에 참석하지 않아요"],
    ["booking_reminder", "5분 뒤 회의실 C 예약이 시작돼요"],
  ] as const)("renders %s as an accessible link or button", (type, text) => {
    const item = notification(type);
    const { container } = render(
      <NotificationRow item={item} now={now} onActivate={vi.fn()} />,
    );
    const row = screen.getByRole(item.href ? "link" : "button");
    expect(row).toHaveAccessibleName(
      expect.stringContaining(`읽지 않음 · ${text}`),
    );
    expect(row).toHaveAccessibleName(expect.stringContaining("5분 전"));
    expect(row).toHaveClass("min-h-11");
    expect(
      container.querySelector("[data-slot=notification-unread-dot]"),
    ).toBeInTheDocument();
    expect(
      [...container.querySelectorAll("strong")].map(
        (element) => element.textContent,
      ),
    ).toEqual(
      type === "booking_reminder" ? ["회의실 C"] : ["박지훈", "회의실 C"],
    );
    if (item.href) expect(row).toHaveAttribute("href", item.href);
    else expect(row).not.toHaveAttribute("href");
    expect(screen.queryByText("강남점")).not.toBeInTheDocument();
    expect(screen.queryByText("7F")).not.toBeInTheDocument();
  });

  it("shows changed times and a snapshot title without adding them to the first line", () => {
    render(
      <NotificationRow
        item={notification("booking_changed")}
        now={now}
        onActivate={vi.fn()}
      />,
    );
    expect(
      screen.getByText("10월 8일 목 14:00–15:00 → 15:00–16:00"),
    ).toBeVisible();
    expect(screen.getByText("· 주간 회의")).toBeVisible();
  });

  it("never renders a reminder title even if a malformed client fixture contains it", () => {
    const item = notification("booking_reminder");
    item.data.title = "뒤늦게 바뀐 제목";
    const { container } = render(
      <NotificationRow item={item} now={now} onActivate={vi.fn()} />,
    );
    expect(screen.queryByText(/뒤늦게 바뀐 제목/)).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
  });

  it("removes the unread dot and name marker from read rows", () => {
    const { container } = render(
      <NotificationRow
        item={{ ...notification(), read: true }}
        now={now}
        onActivate={vi.fn()}
      />,
    );
    expect(
      container.querySelector("[data-slot=notification-unread-dot]"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link")).not.toHaveAccessibleName(
      expect.stringContaining("읽지 않음"),
    );
    expect(screen.getByRole("link")).toHaveClass("text-muted-foreground");
  });

  it("passes the exact item and activation event to the owner of read state", async () => {
    const user = userEvent.setup();
    const item = notification("booking_removed");
    const onActivate = vi.fn();
    render(<NotificationRow item={item} now={now} onActivate={onActivate} />);
    await user.tab();
    expect(screen.getByRole("button")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate.mock.calls[0]?.[0]).toBe(item);
    expect(onActivate.mock.calls[0]?.[1].type).toBe("click");
  });

  it("preserves modified link clicks for the navigation handler", () => {
    const onActivate = vi.fn((_, event) => event.preventDefault());
    render(
      <NotificationRow
        item={notification()}
        now={now}
        onActivate={onActivate}
      />,
    );
    fireEvent.click(screen.getByRole("link"), { ctrlKey: true });
    expect(onActivate.mock.calls[0]?.[1].ctrlKey).toBe(true);
  });

  it("does not submit the same pending row twice", () => {
    const onActivate = vi.fn();
    const { rerender } = render(
      <NotificationRow
        item={notification()}
        now={now}
        onActivate={onActivate}
        pending
      />,
    );
    expect(screen.getByRole("link")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByRole("link"));
    rerender(
      <NotificationRow
        item={notification("booking_removed")}
        now={now}
        onActivate={onActivate}
        pending
      />,
    );
    expect(screen.getByRole("button")).toBeDisabled();
    fireEvent.click(screen.getByRole("button"));
    expect(onActivate).not.toHaveBeenCalled();
  });
});

describe("notification lists and loading", () => {
  it("shares the same rows while keeping their identities across read updates", () => {
    const first = notification();
    const second = notification("participant_left");
    const onActivate = vi.fn();
    const { rerender } = render(
      <NotificationList
        items={[first, second]}
        now={now}
        onActivate={onActivate}
        pendingIds={new Set([first.id])}
      />,
    );
    const rows = screen.getAllByRole("link");
    expect(rows[0]).toHaveAttribute("aria-disabled", "true");
    expect(rows[1]).not.toHaveAttribute("aria-disabled");
    rows[1]?.focus();
    rerender(
      <NotificationList
        items={[{ ...first, read: true }, second]}
        now={now}
        onActivate={onActivate}
      />,
    );
    expect(screen.getAllByRole("link")[1]).toBe(rows[1]);
    expect(rows[1]).toHaveFocus();
  });

  it("has different empty copy for the bell and full page", () => {
    const { rerender } = render(
      <NotificationList items={[]} now={now} onActivate={vi.fn()} />,
    );
    expect(screen.getByText("새 알림이 없어요")).toBeVisible();
    rerender(
      <NotificationList
        items={[]}
        now={now}
        onActivate={vi.fn()}
        emptyLabel="알림이 아직 없어요"
      />,
    );
    expect(screen.getByText("알림이 아직 없어요")).toBeVisible();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("renders six skeleton rows and never confuses loading with an empty list", () => {
    const { container } = render(<NotificationListSkeleton />);
    expect(
      container.querySelectorAll("[data-slot=notification-skeleton-row]"),
    ).toHaveLength(6);
    expect(container.querySelector("[aria-busy=true]")).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByText(/알림이 (아직 )?없어요/)).not.toBeInTheDocument();
  });
});
