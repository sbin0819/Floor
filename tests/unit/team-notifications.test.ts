import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTeamNotifications } from "@/features/notifications/builders";
import { fetchNotificationSummary } from "@/features/notifications/client";
import {
  notificationHref,
  notificationPresentation,
} from "@/features/notifications/format";
import {
  parseNotificationContent,
  parseNotificationData,
  type NotificationSnapshot,
} from "@/features/notifications/types";
import {
  parseSystemMessageData,
  systemMessageText,
} from "@/features/chat/system-messages";

const teamId = "2c378d77-915b-4c4e-9352-eb424480ba43";
const actor = { id: "actor", name: "박지훈" };
const data = { actorName: actor.name, teamName: "디자인팀" };
const now = new Date("2026-10-09T00:00:00Z");
const snapshots: NotificationSnapshot[] = [
  { type: "team_removed", data },
  { type: "team_role_changed", data: { ...data, teamId, role: "admin" } },
  { type: "team_role_changed", data: { ...data, teamId, role: "member" } },
  { type: "team_deleted", data },
];

afterEach(() => vi.unstubAllGlobals());

describe("team notification snapshots", () => {
  it.each(snapshots)(
    "parses $type without retaining a booking reference",
    (snapshot) => {
      expect(
        parseNotificationContent(snapshot.type, snapshot.data, "booking"),
      ).toEqual({
        ...snapshot,
        bookingId: null,
      });
    },
  );

  it.each([
    { teamName: data.teamName },
    { actorName: data.actorName },
    { ...data, actorName: "" },
    { ...data, teamName: "" },
    { ...data, email: "private@example.test" },
    { ...data, userId: "private" },
    { ...data, teamId },
    { ...data, role: "admin" },
  ])("rejects incomplete or extra ordinary fields: %j", (invalid) => {
    expect(parseNotificationData("team_removed", invalid)).toBeNull();
    expect(parseNotificationData("team_deleted", invalid)).toBeNull();
  });

  it.each([
    data,
    { ...data, teamId },
    { ...data, role: "member" },
    { ...data, teamId: "../teams", role: "admin" },
    { ...data, teamId, role: "owner" },
    { ...data, teamId, role: "admin", email: "private@example.test" },
  ])("rejects invalid role-change data: %j", (invalid) => {
    expect(parseNotificationData("team_role_changed", invalid)).toBeNull();
  });

  it("keeps notification kinds distinct", () => {
    expect(
      parseNotificationData("team_role_changed", { actorName: actor.name }),
    ).toBeNull();
    expect(parseNotificationData("friend_request", data)).toBeNull();
    expect(parseNotificationData("booking_invited", data)).toBeNull();
  });
});

describe("team notification text and destinations", () => {
  it.each([
    [snapshots[0]!, "박지훈 님이 나를 디자인팀에서 내보냈어요", "/teams"],
    [
      snapshots[1]!,
      "박지훈 님이 나를 디자인팀의 팀 관리자로 지정했어요",
      `/teams/${teamId}`,
    ],
    [
      snapshots[2]!,
      "박지훈 님이 나를 디자인팀의 팀원으로 바꿨어요",
      `/teams/${teamId}`,
    ],
    [snapshots[3]!, "박지훈 님이 ‘디자인팀’을(를) 지웠어요", "/teams"],
  ] as const)("formats %j using stored names", (snapshot, text, href) => {
    const presentation = notificationPresentation(snapshot);
    expect(presentation.text).toBe(text);
    expect(presentation.dateTime).toBeUndefined();
    expect(presentation.parts.filter((part) => part.strong)).toEqual([
      { text: actor.name, strong: true },
      { text: data.teamName, strong: true },
    ]);
    expect(notificationHref({ ...snapshot, bookingId: null })).toBe(href);
  });
});

describe("team notification builder", () => {
  it.each(["team_removed", "team_deleted"] as const)(
    "builds %s once per recipient and excludes the actor",
    (type) => {
      const rows = buildTeamNotifications({
        type,
        actor,
        teamName: data.teamName,
        userIds: ["member", actor.id, "member", "other"],
        now,
      });
      expect(rows).toEqual(
        ["member", "other"].map((userId) => ({
          userId,
          type,
          data,
          bookingId: null,
          actorId: actor.id,
          scheduledFor: now,
          expiresAt: null,
        })),
      );
    },
  );

  it("takes a name snapshot rather than retaining a mutable actor reference", () => {
    const changingActor = { ...actor };
    const rows = buildTeamNotifications({
      type: "team_role_changed",
      actor: changingActor,
      teamName: data.teamName,
      teamId,
      role: "member",
      userIds: ["member"],
      now,
    });
    changingActor.name = "바뀐 이름";
    expect(rows[0]?.data).toEqual({ ...data, teamId, role: "member" });
    expect(rows[0]?.type).toBe("team_role_changed");
    expect(
      buildTeamNotifications({
        type: "team_deleted",
        actor,
        teamName: data.teamName,
        userIds: [actor.id],
        now,
      }),
    ).toEqual([]);
  });

  it("does not create malformed snapshots", () => {
    expect(() =>
      buildTeamNotifications({
        type: "team_removed",
        actor: { ...actor, name: "" },
        teamName: data.teamName,
        userIds: ["member"],
        now,
      }),
    ).toThrow("Invalid team notification snapshot.");
  });
});

describe("team notification client response", () => {
  const items = snapshots.map((snapshot, index) => ({
    ...snapshot,
    id: `notification-${index}`,
    actorAvatar: null,
    bookingId: null,
    read: false,
    scheduledFor: now.toISOString(),
    href: notificationHref({ ...snapshot, bookingId: null }),
  }));
  const summary = {
    items,
    unreadCount: items.length,
    now: now.toISOString(),
    nextAt: null,
  };

  it("accepts all team kinds together", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(summary)));
    expect(
      await fetchNotificationSummary(new AbortController().signal),
    ).toEqual(summary);
  });

  it("rejects an absent actor snapshot rather than inferring a current name", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          ...summary,
          items: [{ ...items[0], data: { teamName: data.teamName } }],
        }),
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

describe("team rename system message", () => {
  const renamed = {
    type: "team_renamed" as const,
    actorName: actor.name,
    name: "UX디자인팀",
  };
  it("renders the fixed Korean sentence from a strict snapshot", () => {
    expect(parseSystemMessageData(renamed)).toEqual(renamed);
    expect(systemMessageText(renamed)).toBe(
      "박지훈 님이 팀 이름을 ‘UX디자인팀’(으)로 바꿨어요",
    );
  });
  it.each([
    { ...renamed, actorName: "" },
    { ...renamed, name: "" },
    { ...renamed, name: null },
    { ...renamed, email: "private@example.test" },
  ])("rejects invalid rename data: %j", (invalid) => {
    expect(parseSystemMessageData(invalid)).toBeNull();
  });
});
