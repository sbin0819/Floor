import { type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import userEvent from "@testing-library/user-event";
import { MeetingScreen } from "@/features/chat/components/channel-screen";
import {
  MeetingBookingCard,
  MeetingMembers,
} from "@/features/chat/components/meeting-room-presentation";
import { SystemMessageContent } from "@/features/chat/components/system-message-content";
import type { SystemMessageData } from "@/features/chat/system-messages";
import { systemMessageText } from "@/features/chat/system-messages";
import { meetingView, meetingChatNav } from "../helpers/meeting";
import { installChatViewport } from "../helpers/chat-viewport";

const realtime = vi.hoisted(() => ({
  denied: false,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/features/chat/actions", () => ({
  sendMessage: vi.fn(),
  setReaction: vi.fn(),
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
  setRoomMuted: vi.fn(),
  markRoomRead: vi.fn(async ({ seq }: { seq: number }) => ({
    ok: true,
    data: { lastReadSeq: seq },
  })),
}));
vi.mock("@/components/realtime-provider", () => ({
  useRealtimeScope: () =>
    realtime.denied
      ? {
          channels: [],
          requestedRooms: ["a1111111-1111-4111-8111-111111111111"],
        }
      : { channels: null, requestedRooms: [] },
  usePresenceStatus: () => "unknown",
  usePresenceStatuses: () => ({}),
  useRealtimeChannel: () => {},
  useRealtimeConnectionState: () => "disabled",
  useRealtimeLifecycle: () => {},
  useRealtimePresence: () => vi.fn(),
}));
let restore: () => void;
beforeEach(() => {
  realtime.denied = false;
  restore = installChatViewport();
});
afterEach(() => restore());
async function setup(ui: ReactNode) {
  const client = new QueryClient();
  client.setQueryData(["chat", "nav"], meetingChatNav());
  let result!: ReturnType<typeof render>;
  await act(async () => {
    result = render(
      <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
    );
  });
  return result;
}
describe("shared meeting screen", () => {
  it.each([
    ["2026-10-08T01:59:59Z", "confirmed", "곧 시작"],
    ["2026-10-08T02:00:00Z", "confirmed", "진행 중"],
    ["2026-10-08T03:00:00Z", "confirmed", "지난 회의"],
    ["2026-10-08T01:00:00Z", "cancelled", "취소됨"],
  ] as const)(
    "renders the server-clock phase at %s",
    async (now, status, label) => {
      const data = meetingView();
      await setup(
        <MeetingScreen
          data={{ ...data, now, booking: { ...data.booking, status } }}
        />,
      );
      expect(
        screen.getByRole("heading", { name: "디자인 회의", level: 1 }),
      ).toBeInTheDocument();
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "멤버 2명" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("combobox", { name: "메시지" }),
      ).toBeInTheDocument();
    },
  );
  it("uses the space name only as plain fallback title and booking text", async () => {
    const data = meetingView();
    const { container } = await setup(
      <MeetingScreen
        data={{
          ...data,
          booking: { ...data.booking, title: null },
          canEditBooking: false,
        }}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "가상 회의실 회의" }),
    ).toBeInTheDocument();
    expect(container.querySelector('a[href*="/branches/"]')).toBeNull();
    expect(container.querySelector("img")).toBeNull();
    expect(
      screen.queryByRole("link", { name: "예약 바꾸기" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /통화|영상/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "파일 공유는 준비 중이에요" }),
    ).toBeDisabled();
  });
  it("allows every meeting member to mention everyone and uses the meeting placeholder", async () => {
    await setup(
      <MeetingScreen
        data={meetingView({ isBooker: false, canEditBooking: false })}
      />,
    );
    const input = screen.getByRole("combobox", { name: "메시지" });
    expect(input).toHaveAttribute("placeholder", "디자인 회의에 메시지 보내기");
    await userEvent.setup().type(input, "@");
    expect(screen.getByRole("option", { name: /모두/ })).toBeInTheDocument();
  });
  it.each<SystemMessageData>([
    { type: "booking_created", actorName: "홍유진" },
    {
      type: "booking_time_changed",
      actorName: "홍유진",
      timezone: "Asia/Seoul",
      previousStart: "2026-10-08T00:00:00Z",
      previousEnd: "2026-10-08T01:00:00Z",
      start: "2026-10-08T02:00:00Z",
      end: "2026-10-08T03:00:00Z",
    },
    { type: "participants_added", actorName: "홍유진", names: ["김민지"] },
    { type: "participant_removed", actorName: "홍유진", names: ["김민지"] },
    { type: "participant_left", name: "김민지" },
    { type: "booking_cancelled", actorName: "홍유진" },
  ])(
    "renders meeting system rows without member avatars or message tools: $type",
    async (data) => {
      const { container } = await setup(
        <SystemMessageContent
          data={data}
          body="사용하지 않는 본문"
          createdAt="2026-10-08T01:00:00Z"
        />,
      );
      expect(screen.getByText(systemMessageText(data))).toBeInTheDocument();
      expect(
        container.querySelector("[data-system-message]"),
      ).toBeInTheDocument();
      expect(screen.queryByRole("toolbar")).not.toBeInTheDocument();
      expect(screen.queryByRole("img")).not.toBeInTheDocument();
    },
  );
  it.each(["ended", "cancelled"] as const)(
    "keeps own delete but disables editing/reactions/send when %s",
    async (readOnlyReason) => {
      await setup(
        <MeetingScreen
          data={meetingView({
            canWrite: false,
            canEditBooking: false,
            readOnlyReason,
          })}
        />,
      );
      expect(
        screen.getByText(
          readOnlyReason === "ended"
            ? "회의가 끝나고 24시간이 지나 읽기 전용이에요"
            : "취소된 예약이라 읽기 전용이에요",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("combobox", { name: "메시지" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "수정" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "리액션 고르기" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "👍 좋아요 추가" }),
      ).not.toBeInTheDocument();
      await userEvent
        .setup()
        .click(screen.getByRole("button", { name: "메시지 더보기" }));
      expect(
        screen.getByRole("menuitem", { name: "삭제" }),
      ).toBeInTheDocument();
    },
  );
  it("keeps server booker-first order regardless of alphabetical/presence order", async () => {
    await setup(<MeetingMembers members={meetingView().members} />);
    const rows = within(
      screen.getByRole("list", { name: "회의 멤버 목록" }),
    ).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("홍유진");
    expect(rows[0]).toHaveTextContent("예약한 사람");
    expect(rows[1]).toHaveTextContent("김민지");
  });
  it("keeps a single member sheet on narrow screens and restores trigger focus", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    await setup(<MeetingScreen data={meetingView()} />);
    const trigger = screen.getByRole("button", { name: "멤버 2명" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "회의 멤버" })).toBeVisible();
    expect(
      screen.getAllByRole("list", { name: "회의 멤버 목록" }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "멤버 목록 닫기" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it("opens the meeting members in the wide pane", async () => {
    await setup(<MeetingScreen data={meetingView()} />);
    const trigger = screen.getByRole("button", { name: "멤버 2명" });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("complementary", { name: "회의 멤버" }),
    ).toHaveTextContent("예약한 사람");
  });
  it("hides all meeting details after reauthorization rejects access but keeps sheet closing controls", async () => {
    realtime.denied = true;
    const { container } = await setup(
      <MeetingScreen
        data={meetingView()}
        variant="sheet"
        actions={<button>부모 시트 닫기</button>}
      />,
    );
    expect(screen.getByText("이 대화를 더 볼 수 없어요")).toBeInTheDocument();
    expect(screen.queryByText("디자인 회의")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: "예약 정보" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "부모 시트 닫기" }),
    ).toBeInTheDocument();
    expect(container.querySelector("[data-chat-screen]")).toBeNull();
  });
  it("keeps existing reaction counts visible but disabled in a read-only meeting", async () => {
    const data = meetingView({ canWrite: false, readOnlyReason: "ended" });
    data.messages[0]!.reactions = [
      { emoji: "thumbs_up", count: 1, mine: false, names: ["김민지"] },
    ];
    await setup(<MeetingScreen data={data} />);
    expect(
      screen.getByRole("button", { name: "👍 1명. 누르면 추가" }),
    ).toBeDisabled();
  });
  it("renders one compact screen in a persistent parent sheet with action controls and expandable card", async () => {
    const { container } = await setup(
      <MeetingScreen
        data={meetingView()}
        variant="sheet"
        actions={<button>부모 시트 닫기</button>}
      />,
    );
    expect(container.querySelector("[data-chat-screen]")).toBeNull();
    expect(
      screen.getByRole("heading", { name: "디자인 회의", level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "멤버 2명" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("멤버 2명")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "부모 시트 닫기" }),
    ).toBeInTheDocument();
    const card = screen.getByRole("region", { name: "예약 정보" });
    const toggle = within(card).getByRole("button", { name: /가상 회의실/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(
      within(card).getByRole("link", { name: "예약 바꾸기" }),
    ).toHaveAttribute("href", `/bookings/${meetingView().booking.id}/edit`);
  });
  it("shows only five member initials plus the remaining count without images", async () => {
    const data = meetingView();
    data.members = Array.from({ length: 7 }, (_, i) => ({
      ...data.members[0]!,
      userId: `member${i}`,
      name: `멤버${i}`,
      isBooker: i === 0,
    }));
    await setup(<MeetingBookingCard data={data} />);
    expect(screen.getAllByRole("img")).toHaveLength(5);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });
});
