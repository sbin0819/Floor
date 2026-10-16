import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchNotificationSummary } from "@/features/notifications/client";
import {
  notificationHref,
  notificationPresentation,
} from "@/features/notifications/format";
import {
  parseNotificationContent,
  parseNotificationData,
} from "@/features/notifications/types";

const data = {
  actorName: "김하은",
  spaceName: "독서 모임",
  inviteCode: "Abcdefghijklmnopqrstuv",
};
const item = {
  id: "notification",
  type: "space_invite" as const,
  data,
  read: false,
  actorAvatar: null,
  scheduledFor: "2026-10-09T00:00:00Z",
  bookingId: null,
  href: `/s/join/${data.inviteCode}`,
};
const summary = {
  items: [item],
  unreadCount: 1,
  now: item.scheduledFor,
  nextAt: null,
};
afterEach(() => vi.unstubAllGlobals());

describe("space invitation notification contract", () => {
  it("uses a private-field-free snapshot, Korean copy and the invitation route", () => {
    expect(parseNotificationContent("space_invite", data, null)).toEqual({
      type: "space_invite",
      data,
      bookingId: null,
    });
    expect(notificationPresentation(item).text).toBe(
      "김하은 님이 독서 모임 스페이스에 초대했어요",
    );
    expect(notificationHref(item)).toBe(`/s/join/${data.inviteCode}`);
  });
  it.each([
    { ...data, inviteCode: "../unsafe" },
    { ...data, userId: "hidden" },
    { ...data, email: "private@example.test" },
    { ...data, spaceName: "" },
    { actorName: data.actorName },
  ])("rejects malformed or extra snapshot fields: %j", (invalid) => {
    expect(parseNotificationData("space_invite", invalid)).toBeNull();
  });
  it("accepts a mixed summary containing an invitation without failing the bell", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(summary)));
    expect(
      await fetchNotificationSummary(new AbortController().signal),
    ).toEqual(summary);
  });
  it.each([
    { ...data, inviteCode: "x".repeat(23) },
    { ...data, inviteCode: "x".repeat(21) + "/" },
    { ...data, spaceId: "hidden" },
  ])("rejects invalid invitation response data: %j", async (invalid) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ ...summary, items: [{ ...item, data: invalid }] }),
        ),
    );
    await expect(
      fetchNotificationSummary(new AbortController().signal),
    ).rejects.toMatchObject({
      name: "ApiError",
      kind: "invalid_response",
      status: 200,
    });
  });
});
