import { QueryClient } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  meetingName,
  meetingStartLabel,
  meetingTime,
} from "@/features/chat/meeting-format";
import { MeetingList } from "@/features/chat/components/meeting-list";
import { ChatRailNavigation } from "@/components/chat-navigation";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  activeMemberNav,
  memberSectionName,
} from "@/components/member-navigation";
import {
  CHAT_NAV_KEY,
  applyMention,
  applyRoomActivity,
  chatNavRevision,
  clearRoomUnread,
  homeUnreadCount,
  mergeChatNav,
  reportRoomViewport,
} from "@/features/chat/nav-state";
import type { ChatNav } from "@/features/chat/types";
import { meetingChatNav, meetingNav, meetingNow } from "../helpers/meeting";
vi.mock("next/navigation", () => ({
  usePathname: () => "/m/b1111111-1111-4111-8111-111111111111",
  useRouter: () => ({ push: vi.fn() }),
}));
describe("meeting navigation", () => {
  it("keeps meeting routes in the messages area without matching unrelated prefixes", () => {
    expect(activeMemberNav(`/m/${meetingNav().bookingId}`)).toBe("messages");
    expect(memberSectionName(`/m/${meetingNav().bookingId}`)).toBe("메시지");
    expect(activeMemberNav("/meeting")).toBeNull();
  });
  it("uses server now and the booking timezone for today, tomorrow and other days", () => {
    expect(
      meetingStartLabel("2026-10-08T02:00:00Z", "Asia/Seoul", meetingNow),
    ).toBe("오늘 11:00");
    expect(
      meetingStartLabel("2026-10-09T02:00:00Z", "Asia/Seoul", meetingNow),
    ).toBe("내일 11:00");
    expect(
      meetingStartLabel("2026-10-10T02:00:00Z", "Asia/Seoul", meetingNow),
    ).toBe("10월 10일 11:00");
    expect(
      meetingStartLabel(
        "2026-10-08T08:00:00Z",
        "America/Los_Angeles",
        meetingNow,
      ),
    ).toBe("내일 01:00");
    expect(meetingName(meetingNav({ title: null }))).toBe("가상 회의실 회의");
    expect(meetingTime(meetingNav())).toContain("11:00");
  });
  it("does not invent an empty section and collapses past meetings without dropping current links", () => {
    const { rerender } = render(<MeetingList rows={[]} now={meetingNow} />);
    expect(
      screen.queryByRole("region", { name: "회의" }),
    ).not.toBeInTheDocument();
    rerender(
      <MeetingList
        rows={[
          meetingNav({ unread: true, unreadMentions: 101 }),
          meetingNav({
            bookingId: "past",
            roomId: "past",
            phase: "ended",
            title: "지난 설계",
          }),
        ]}
        now={meetingNow}
      />,
    );
    const active = screen.getByRole("link", {
      name: /디자인 회의, 오늘 11:00, 안 읽은 메시지 있음, 멘션 101개/,
    });
    expect(active).toHaveAttribute("aria-current", "page");
    expect(active).toHaveClass("font-bold");
    expect(screen.getByText("99+")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /지난 설계/ }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "지난 회의 1" }));
    expect(screen.getByRole("link", { name: /지난 설계/ })).toHaveAttribute(
      "href",
      "/m/past",
    );
  });
  it("mutes ordinary unread styling but retains mention count", () => {
    render(
      <MeetingList
        rows={[meetingNav({ muted: true, unread: true, unreadMentions: 2 })]}
        now={meetingNow}
      />,
    );
    const link = screen.getByRole("link", { name: /멘션 2개/ });
    expect(link).not.toHaveClass("font-bold");
    expect(link).toHaveClass("text-muted-foreground");
  });
  it("includes meeting mentions in the Floor icon and shows ongoing text", () => {
    render(
      <TooltipProvider>
        <ChatRailNavigation
          spaces={[]}
          meetings={[meetingNav({ unreadMentions: 3 })]}
        />
        <MeetingList
          rows={[meetingNav({ phase: "ongoing" })]}
          now={meetingNow}
        />
      </TooltipProvider>,
    );
    expect(
      screen.getByRole("link", { name: "Floor 홈, 읽지 않은 메시지 3개" }),
    ).toBeInTheDocument();
    expect(screen.getByText("오늘 11:00 · 진행 중")).toBeInTheDocument();
  });
  it("merges activity, read and mention cursors without stale response rollback", () => {
    const client = new QueryClient();
    const data = meetingChatNav();
    const roomId = data.meetings[0]!.roomId;
    client.setQueryData(CHAT_NAV_KEY, data);
    const revision = chatNavRevision(client);
    applyRoomActivity(client, { roomId, seq: 2, authorId: "other" }, "me");
    applyMention(client, { roomId, seq: 2, messageId: "mention" });
    expect(applyMention(client, { roomId, seq: 2, messageId: "mention" })).toBe(
      false,
    );
    const merged = mergeChatNav(
      client,
      {
        ...data,
        now: "2026-10-08T03:00:00Z",
        meetings: [
          { ...data.meetings[0]!, title: "수정한 제목", phase: "ended" },
        ],
      },
      revision,
    );
    expect(merged.meetings[0]).toMatchObject({
      title: "수정한 제목",
      phase: "ended",
      unread: true,
      unreadMentions: 1,
    });
    client.setQueryData(CHAT_NAV_KEY, merged);
    clearRoomUnread(client, roomId, 1);
    expect(
      client.getQueryData<ChatNav>(CHAT_NAV_KEY)?.meetings[0]?.unread,
    ).toBe(true);
    clearRoomUnread(client, roomId, 2);
    expect(
      client.getQueryData<ChatNav>(CHAT_NAV_KEY)?.meetings[0],
    ).toMatchObject({ unread: false, unreadMentions: 0 });
    expect(
      homeUnreadCount({
        ...data,
        meetings: [
          meetingNav({ muted: true, unread: true, unreadMentions: 4 }),
        ],
      }),
    ).toBe(4);
  });
  it("does not resurrect meetings removed by the authorized server list", () => {
    const client = new QueryClient();
    const data = meetingChatNav();
    client.setQueryData(CHAT_NAV_KEY, data);
    applyRoomActivity(
      client,
      { roomId: data.meetings[0]!.roomId, seq: 5, authorId: "other" },
      "me",
    );
    expect(mergeChatNav(client, { ...data, meetings: [] }, 0).meetings).toEqual(
      [],
    );
  });
  it("does not mark own or visibly read meeting messages unread", () => {
    const client = new QueryClient();
    const data = meetingChatNav();
    const roomId = data.meetings[0]!.roomId;
    client.setQueryData(CHAT_NAV_KEY, data);
    applyRoomActivity(client, { roomId, seq: 2, authorId: "me" }, "me");
    reportRoomViewport(client, roomId, true);
    applyRoomActivity(client, { roomId, seq: 3, authorId: "other" }, "me");
    expect(
      client.getQueryData<ChatNav>(CHAT_NAV_KEY)?.meetings[0]?.unread,
    ).toBe(false);
  });
});
