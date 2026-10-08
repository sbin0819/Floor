import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMentions } from "@/features/chat/components/chat-mentions";
import { CHAT_NAV_KEY, reportRoomViewport } from "@/features/chat/nav-state";
import type { ChatNav } from "@/features/chat/types";
import type { RealtimeEvent } from "@/lib/realtime/types";
import { meetingChatNav, meetingNav } from "../helpers/meeting";
const mocks = vi.hoisted(() => ({
  toast: vi.fn(),
  push: vi.fn(),
  receive: (_event: RealtimeEvent) => {
    void _event;
  },
}));
vi.mock("sonner", () => ({ toast: mocks.toast }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock("@/components/realtime-provider", () => ({
  useRealtimeReauthorize: () => vi.fn(),
  useRealtimeChannel: (_channel: string, receive: typeof mocks.receive) => {
    mocks.receive = receive;
  },
}));
function activity(seq = 2): Extract<RealtimeEvent, { type: "room.activity" }> {
  const row = meetingNav();
  return {
    type: "room.activity",
    roomId: row.roomId,
    roomKind: "meeting",
    spaceId: null,
    bookingId: row.bookingId,
    authorId: "other",
    seq,
    preview: {
      messageId: `m${seq}`,
      authorName: "김민지",
      excerpt: "회의 시작해요",
    },
  };
}
function mention(): Extract<RealtimeEvent, { type: "mention.created" }> {
  const row = meetingNav();
  return {
    type: "mention.created",
    roomId: row.roomId,
    roomKind: "meeting",
    spaceId: null,
    bookingId: row.bookingId,
    roomName: "디자인 회의",
    seq: 2,
    messageId: "m2",
    authorName: "김민지",
    excerpt: "@홍유진 확인해요",
  };
}
function setup(data = meetingChatNav()) {
  const client = new QueryClient();
  client.setQueryData(CHAT_NAV_KEY, data);
  const refresh = vi.fn(async () => client.getQueryData<ChatNav>(CHAT_NAV_KEY));
  render(
    <QueryClientProvider client={client}>
      <ChatMentions userId="me" count={2} refresh={refresh} />
    </QueryClientProvider>,
  );
  return { client, refresh };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  document.title = "Floor";
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
describe("meeting real-time navigation", () => {
  it("marks ordinary messages unread without a toast or redundant read", async () => {
    const { client, refresh } = setup();
    act(() => mocks.receive(activity()));
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(
      client.getQueryData<ChatNav>(CHAT_NAV_KEY)?.meetings[0]?.unread,
    ).toBe(true);
    expect(refresh).not.toHaveBeenCalled();
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it("coalesces missing rooms and system activity into one refresh with no toast", async () => {
    const { refresh } = setup(meetingChatNav({ meetings: [] }));
    act(() => {
      mocks.receive(activity());
      mocks.receive({ ...activity(3), authorId: null, preview: null });
    });
    await act(() => vi.advanceTimersByTimeAsync(600));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(mocks.toast).not.toHaveBeenCalled();
  });
  it("counts mentions once, keeps muted meeting mentions, and links the toast without a channel hash", async () => {
    const { client } = setup(
      meetingChatNav({ meetings: [meetingNav({ muted: true })] }),
    );
    act(() => {
      mocks.receive(mention());
      mocks.receive(mention());
    });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(
      client.getQueryData<ChatNav>(CHAT_NAV_KEY)?.meetings[0]?.unreadMentions,
    ).toBe(1);
    expect(mocks.toast).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledWith(
      "김민지 님이 디자인 회의에서 멘션했어요",
      expect.objectContaining({ description: "@홍유진 확인해요" }),
    );
    mocks.toast.mock.calls[0]![1].action.onClick();
    expect(mocks.push).toHaveBeenCalledWith(`/m/${meetingNav().bookingId}`);
    expect(document.title.startsWith("(2) ")).toBe(true);
  });
  it("suppresses toasts while dnd without losing mention count", async () => {
    const { client } = setup(meetingChatNav({ myStatus: "dnd" }));
    act(() => mocks.receive(mention()));
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(
      client.getQueryData<ChatNav>(CHAT_NAV_KEY)?.meetings[0]?.unreadMentions,
    ).toBe(1);
  });
  it("does not toast or add unread while reading at the bottom in the booking sheet", async () => {
    const { client } = setup();
    reportRoomViewport(client, meetingNav().roomId, true);
    act(() => {
      mocks.receive(activity());
      mocks.receive(mention());
    });
    await act(() => vi.advanceTimersByTimeAsync(300));
    expect(mocks.toast).not.toHaveBeenCalled();
    expect(
      client.getQueryData<ChatNav>(CHAT_NAV_KEY)?.meetings[0],
    ).toMatchObject({ unread: false, unreadMentions: 0 });
  });
});
