import {
  Children,
  cloneElement,
  isValidElement,
  Suspense,
  use,
  type ReactNode,
  type SuspenseProps,
} from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import NotificationsPage from "@/app/(app)/notifications/page";
import { NotificationList } from "@/features/notifications/components/notification-list";
import type { NotificationListData } from "@/features/notifications/types";

const mocks = vi.hoisted(() => ({ guard: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requirePageSession: mocks.guard }));
vi.mock("@/features/notifications/queries", () => ({
  getNotifications: mocks.query,
}));
vi.mock("@/features/notifications/components/notifications-feed", () => ({
  NotificationsFeed: ({
    initialData,
  }: {
    initialData: NotificationListData;
  }) => (
    <>
      <button
        type="button"
        disabled={initialData.unreadCount === 0}
        className="justify-self-end"
      >
        모두 읽음
      </button>
      <div className="col-span-2">
        <NotificationList
          items={initialData.items}
          now={initialData.now}
          onActivate={vi.fn()}
          emptyLabel="알림이 아직 없어요"
        />
      </div>
    </>
  ),
}));

const initialData: NotificationListData = {
  now: "2026-10-08T05:55:00Z",
  unreadCount: 1,
  items: [
    {
      id: "notification",
      type: "booking_invited",
      read: false,
      scheduledFor: "2026-10-08T05:50:00Z",
      bookingId: "booking",
      data: {
        actorName: "박지훈",
        spaceName: "회의실 C",
        floorName: "7F",
        branchName: "강남점",
        timezone: "Asia/Seoul",
        start: "2026-10-08T06:00:00Z",
        end: "2026-10-08T07:00:00Z",
      },
      href: "/bookings?view=calendar&month=2026-10&day=2026-10-08",
    },
  ],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function Streamed({ result }: { result: Promise<ReactNode> }) {
  return use(result);
}
function pageParts() {
  const page = NotificationsPage();
  const children = Children.toArray(page.props.children);
  const boundary = children.find(
    (child) => isValidElement(child) && child.type === Suspense,
  );
  if (!isValidElement<SuspenseProps>(boundary))
    throw new Error("Expected page-local Suspense");
  const content = boundary.props.children;
  if (
    !isValidElement<Record<string, unknown>>(content) ||
    typeof content.type !== "function"
  )
    throw new Error("Expected guarded server content");
  const renderContent = content.type as (
    props: Record<string, unknown>,
  ) => Promise<ReactNode>;
  return {
    page,
    children,
    boundary,
    content: () => renderContent(content.props),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ userId: "member" });
  mocks.query.mockResolvedValue(initialData);
});

describe("notification page streaming", () => {
  it("renders the static title and disabled action while session and list data resolve separately", async () => {
    const guard = deferred<unknown>();
    const query = deferred<NotificationListData>();
    mocks.guard.mockReturnValue(guard.promise);
    mocks.query.mockReturnValue(query.promise);
    const { page, children, boundary, content } = pageParts();
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.query).not.toHaveBeenCalled();
    const result = content();
    let view!: ReturnType<typeof render>;
    await act(async () => {
      view = render(
        cloneElement(
          page,
          {},
          children.map((child) =>
            child === boundary
              ? cloneElement(boundary, {}, <Streamed result={result} />)
              : child,
          ),
        ),
      );
    });
    const heading = screen.getByRole("heading", { name: "알림", level: 1 });
    expect(heading).toBeVisible();
    expect(heading.closest("[aria-busy=true]")).toBeNull();
    expect(screen.getByRole("button", { name: "모두 읽음" })).toBeDisabled();
    expect(
      view.container.querySelectorAll("[data-slot=notification-skeleton-row]"),
    ).toHaveLength(6);
    expect(screen.queryByText("알림이 아직 없어요")).not.toBeInTheDocument();
    expect(mocks.query).not.toHaveBeenCalled();
    await act(async () => {
      guard.resolve({ userId: "member" });
    });
    expect(mocks.guard).toHaveBeenCalledExactlyOnceWith("/notifications");
    expect(mocks.query).toHaveBeenCalledOnce();
    expect(screen.getByRole("heading", { name: "알림" })).toBe(heading);
    expect(screen.getByRole("button", { name: "모두 읽음" })).toBeDisabled();
    await act(async () => {
      query.resolve(initialData);
    });
    expect(screen.getByRole("heading", { name: "알림" })).toBe(heading);
    expect(screen.getByRole("button", { name: "모두 읽음" })).toBeEnabled();
    expect(
      screen.getByRole("link", { name: /예약에 초대했어요/ }),
    ).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(mocks.query).toHaveBeenCalledOnce();
  });

  it("does not query protected notifications when the page guard redirects", async () => {
    const redirect = new Error("NEXT_REDIRECT:/login?next=%2Fnotifications");
    mocks.guard.mockRejectedValue(redirect);
    await expect(pageParts().content()).rejects.toBe(redirect);
    expect(mocks.guard).toHaveBeenCalledExactlyOnceWith("/notifications");
    expect(mocks.query).not.toHaveBeenCalled();
  });

  it("passes one complete 100-row result without an extra request", async () => {
    const first = initialData.items[0]!;
    const data = {
      ...initialData,
      items: Array.from({ length: 100 }, (_, index) => ({
        ...first,
        id: `notification-${index}`,
      })),
    };
    mocks.query.mockResolvedValue(data);
    render(await pageParts().content());
    expect(screen.getAllByRole("listitem")).toHaveLength(100);
    expect(mocks.query).toHaveBeenCalledOnce();
  });

  it("uses the standard member list width and the page's empty copy", async () => {
    mocks.query.mockResolvedValue({
      ...initialData,
      items: [],
      unreadCount: 0,
    });
    const { page, content } = pageParts();
    expect(page.props.width).toBeUndefined();
    render(await content());
    expect(screen.getByText("알림이 아직 없어요")).toBeVisible();
    expect(screen.getByRole("button", { name: "모두 읽음" })).toBeDisabled();
  });
});
