import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBranchAnnouncementNotifications } from "@/features/notifications/builders";
import {
  fetchNotificationSummary,
  NotificationFetchError,
} from "@/features/notifications/client";
import {
  notificationHref,
  notificationPresentation,
} from "@/features/notifications/format";
import {
  notificationTypes,
  parseNotificationContent,
  parseNotificationData,
} from "@/features/notifications/types";

const announcementId = "82000000-0000-4000-8000-000000000001";
const now = new Date("2026-10-09T03:00:00Z");
const data = {
  branchName: "강남점",
  title: "정전 안내",
  body: "7층은 8시부터 이용해 주세요.\n고맙습니다.",
  announcementId,
};
const item = {
  type: "branch_announcement" as const,
  data,
  bookingId: null,
  href: null,
  id: "notice",
  actorAvatar: null,
  read: false,
  scheduledFor: now.toISOString(),
};
const summary = {
  items: [item],
  now: now.toISOString(),
  unreadCount: 1,
  nextAt: null,
};
afterEach(() => vi.unstubAllGlobals());

describe("branch announcement notification snapshots", () => {
  it("adds the kind and keeps exactly the immutable four-field snapshot", () => {
    expect(notificationTypes).toContain("branch_announcement");
    expect(parseNotificationContent(item.type, data, "booking")).toEqual({
      type: item.type,
      data,
      bookingId: null,
    });
    expect(notificationHref(item)).toBeNull();
    expect(notificationPresentation(item)).toEqual({
      text: "강남점 공지 · 정전 안내",
      parts: [
        { text: "강남점", strong: true },
        { text: " 공지 · ", strong: false },
        { text: "정전 안내", strong: true },
      ],
      dateTime: undefined,
    });
  });
  it.each([
    { ...data, title: "" },
    { ...data, title: "가".repeat(61) },
    { ...data, body: "" },
    { ...data, body: "가".repeat(501) },
    { ...data, title: "제목\0" },
    { ...data, body: "내용\0" },
    { ...data, branchName: "" },
    { ...data, announcementId: "../notice" },
    { ...data, actorName: "금지된 추가 이름" },
    { ...data, email: "private@example.test" },
    { ...data, userId: "private" },
    { ...data, recipientNames: ["이름"] },
  ])("rejects malformed or private extra fields: %j", (invalid) => {
    expect(parseNotificationData(item.type, invalid)).toBeNull();
  });
  it("counts Unicode code points at the exact database text boundaries", () => {
    expect(
      parseNotificationData(item.type, {
        ...data,
        title: "😀".repeat(60),
        body: "😀".repeat(500),
      }),
    ).not.toBeNull();
    expect(
      parseNotificationData(item.type, { ...data, title: "😀".repeat(61) }),
    ).toBeNull();
    expect(parseNotificationData("booking_invited", data)).toBeNull();
    expect(parseNotificationData("friend_request", data)).toBeNull();
  });
  it("builds one notification per recipient, excludes its actor and never persists input metadata", () => {
    const input = {
      ...data,
      actorId: "actor",
      userIds: ["member", "actor", "member", "other"],
      now,
    };
    const rows = buildBranchAnnouncementNotifications(input);
    input.body = "수정 후 본문";
    expect(rows).toEqual(
      ["member", "other"].map((userId) => ({
        type: item.type,
        data,
        userId,
        actorId: "actor",
        bookingId: null,
        scheduledFor: now,
        expiresAt: null,
      })),
    );
    expect(
      buildBranchAnnouncementNotifications({ ...input, userIds: ["actor"] }),
    ).toEqual([]);
    expect(() =>
      buildBranchAnnouncementNotifications({ ...input, title: "" }),
    ).toThrow("Invalid branch announcement snapshot.");
  });
  it("accepts the strict client response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(summary)));
    expect(
      await fetchNotificationSummary(new AbortController().signal),
    ).toEqual(summary);
  });
  it.each([
    { ...item, data: { ...data, email: "private@example.test" } },
    { ...item, bookingId: "booking" },
    { ...item, href: "/announcements/notice" },
    { ...item, data: { actorName: "예약 알림" } },
  ])("rejects a mixed or overexposed client snapshot: %j", async (invalid) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(Response.json({ ...summary, items: [invalid] })),
    );
    await expect(
      fetchNotificationSummary(new AbortController().signal),
    ).rejects.toEqual(new NotificationFetchError(500));
  });
});
