import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { NotificationRow } from "@/features/notifications/components/notification-list";
import { welcomeNotificationDetail } from "@/features/notifications/format";
import type { NotificationItem } from "@/features/notifications/types";

const now = "2026-11-05T03:05:00Z";
const item: NotificationItem = {
  id: "welcome",
  type: "welcome",
  data: { name: "김하은" },
  actorAvatar: null,
  read: false,
  bookingId: null,
  scheduledFor: "2026-11-05T03:00:00Z",
  href: "/",
};

describe("welcome notification row", () => {
  it("renders a home link with an icon instead of an avatar and shows the guidance line", () => {
    const { container } = render(
      <NotificationRow item={item} now={now} onActivate={vi.fn()} />,
    );
    const row = screen.getByRole("link");
    expect(row).toHaveAttribute("href", "/");
    expect(row).toHaveAccessibleName(
      expect.stringContaining(
        "읽지 않음 · 환영해요, 김하은 님! Floor에 처음 오셨네요",
      ),
    );
    expect(row).toHaveAccessibleName(
      expect.stringContaining(welcomeNotificationDetail),
    );
    expect(row).toHaveAccessibleName(expect.stringContaining("5분 전"));
    expect(
      container.querySelector("[data-user-avatar]"),
    ).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(
      [...container.querySelectorAll("strong")].map(
        (element) => element.textContent,
      ),
    ).toEqual(["김하은"]);
    expect(screen.getByText(welcomeNotificationDetail)).toBeInTheDocument();
  });
});
