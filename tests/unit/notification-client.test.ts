import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchNotificationSummary,
  NotificationFetchError,
} from "@/features/notifications/client";

const data = {
  items: [],
  unreadCount: 3,
  now: "2026-10-08T05:55:00Z",
  nextAt: null,
};
afterEach(() => vi.unstubAllGlobals());
describe("notification summary transport", () => {
  it("uses the no-store summary endpoint with cancellation and same-origin credentials", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(data));
    vi.stubGlobal("fetch", fetch);
    const signal = new AbortController().signal;
    expect(await fetchNotificationSummary(signal)).toEqual(data);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/notifications", {
      signal,
      cache: "no-store",
      credentials: "same-origin",
    });
  });
  it.each([401, 500])("hides HTTP %s response contents", async (status) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(new Response("private@example.com", { status })),
    );
    const error = await fetchNotificationSummary(
      new AbortController().signal,
    ).catch((error: unknown) => error);
    expect(error).toEqual(new NotificationFetchError(status));
    expect(String(error)).not.toContain("private@example.com");
  });
  it.each([
    { ...data, unreadCount: -1 },
    { ...data, unknown: "private@example.com" },
    { ...data, now: "invalid" },
  ])("rejects malformed results with a fixed error", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body)));
    await expect(
      fetchNotificationSummary(new AbortController().signal),
    ).rejects.toEqual(new NotificationFetchError(500));
  });
  it("rejects an external link and any private extra fields in notification data", async () => {
    const item = {
      id: "one",
      type: "booking_invited",
      read: false,
      scheduledFor: data.now,
      bookingId: null,
      href: "//external.example",
      data: {
        spaceName: "회의실",
        floorName: "7F",
        branchName: "강남점",
        timezone: "Asia/Seoul",
        start: "2026-10-08T06:00:00Z",
        end: "2026-10-08T07:00:00Z",
      },
    };
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ...data, items: [item] }))
      .mockResolvedValueOnce(
        Response.json({
          ...data,
          items: [
            {
              ...item,
              href: "/bookings",
              data: { ...item.data, email: "private@example.com" },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetch);
    await expect(
      fetchNotificationSummary(new AbortController().signal),
    ).rejects.toEqual(new NotificationFetchError(500));
    await expect(
      fetchNotificationSummary(new AbortController().signal),
    ).rejects.toEqual(new NotificationFetchError(500));
  });
});
