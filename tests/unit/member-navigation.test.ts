import { describe, expect, it } from "vitest";
import { memberSectionName } from "@/components/member-navigation";

describe("member section name", () => {
  it.each([
    ["/", "홈"],
    ["/branches", "공간 예약"],
    ["/branches/a/floors/b", "공간 예약"],
    ["/booking", "공간 예약"],
    ["/booking/entry", "공간 예약"],
    ["/bookings", "내 예약"],
    ["/bookings/past", "내 예약"],
    ["/bookings/x/edit", "내 예약"],
    ["/teams", "팀 관리"],
    ["/teams/start", "팀 관리"],
    ["/teams/team-a", "팀 관리"],
    ["/invite/private-token", "팀 관리"],
    ["/messages", "메시지"],
    ["/s/space", "메시지"],
    ["/s/space/room", "메시지"],
    ["/notifications", "알림"],
    ["/notifications/item", "알림"],
    ["/bookings-extra", null],
    ["/branchestest", null],
    ["/teamster", null],
    ["/invited", null],
    ["/admin", null],
    ["/notificationsx", null],
    ["/unknown", null],
    ["/messages-extra", null],
    ["/spaces", null],
  ])("labels %s as %s", (pathname, expected) => {
    expect(memberSectionName(pathname)).toBe(expected);
  });
});
