import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  ChannelScreen,
  DirectMessageScreen,
  MeetingScreen,
} from "@/features/chat/components/channel-screen";
import { fetchRoomFiles } from "@/features/chat/file-client";
import type { RoomFilesPage } from "@/features/chat/file-types";
import type { ChannelView, DirectMessageView } from "@/features/chat/types";
import { installChatViewport } from "../helpers/chat-viewport";
import { meetingChatNav, meetingView } from "../helpers/meeting";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(window.location.search),
  usePathname: () => window.location.pathname,
}));
vi.mock("@/features/chat/actions", () => ({
  sendMessage: vi.fn(),
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
  setReaction: vi.fn(),
  setRoomMuted: vi.fn(),
  setSpaceMuted: vi.fn(),
  respondMessageRequest: vi.fn(),
  markRoomRead: vi.fn(async ({ seq }: { seq: number }) => ({
    ok: true,
    data: { lastReadSeq: seq },
  })),
}));
vi.mock("@/features/chat/client", () => ({ fetchRoomMessagesPage: vi.fn() }));
vi.mock("@/features/chat/file-client", async (original) => ({
  ...(await original<typeof import("@/features/chat/file-client")>()),
  fetchRoomFiles: vi.fn(),
}));
vi.mock("@/components/realtime-provider", () => ({
  useRealtimeScope: () => ({ channels: null, requestedRooms: [] }),
  usePresenceStatus: () => "unknown",
  usePresenceStatuses: () => ({}),
  useRealtimeChannel: () => undefined,
  useRealtimeLifecycle: () => undefined,
  useRealtimeConnectionState: () => "disabled",
  useRealtimePresence: () => () => undefined,
}));

const source = meetingView();
const channel: ChannelView = {
  call: null,
  canCall: false,
  space: { id: "space", name: "가상 디자인팀", muted: false },
  room: {
    ...source.room,
    name: "일반",
    kind: "text",
    archived: false,
    adminOnly: false,
    topic: null,
  },
  user: source.user,
  members: source.members.map((member) => ({
    id: member.userId,
    name: member.name,
    admin: false,
  })),
  messages: source.messages,
  canWrite: true,
  lastReadSeq: 1,
  firstUnreadSeq: null,
  now: source.now,
};
const direct: Extract<DirectMessageView, { kind: "dm" }> = {
  ...channel,
  kind: "dm",
  request: null,
  blockedByMe: false,
  peerReadSeq: 0,
  other: {
    userId: source.members[1]!.userId,
    name: "김민지",
    username: "minji",
    sharesSpace: false,
  },
};
const group: Extract<DirectMessageView, { kind: "group_dm" }> = {
  ...channel,
  kind: "group_dm",
  name: "가상 그룹",
  displayName: "가상 그룹",
  members: source.members.map(({ userId, name, username, sharesSpace }) => ({
    userId,
    name,
    username,
    sharesSpace,
  })),
};
const page = (name = "리뷰 자료.pdf"): RoomFilesPage => ({
  files: [
    {
      id: "f1111111-1111-4111-8111-111111111111",
      name,
      size: 1234,
      kind: "file",
      width: null,
      height: null,
      uploaderName: "홍유진",
      sentAt: source.now,
      messageId: source.messages[0]!.id,
      seq: 1,
    },
  ],
  hasMore: false,
  nextCursor: null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
let restore: () => void;
const clients: QueryClient[] = [];
beforeEach(() => {
  restore = installChatViewport();
  vi.mocked(fetchRoomFiles).mockReset().mockResolvedValue(page());
  window.history.replaceState(null, "", "/s/space/room");
});
afterEach(() => {
  clients.splice(0).forEach((client) => client.clear());
  restore();
});
function renderScreen(children: ReactNode, enabled = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  client.setQueryData(
    ["chat", "nav"],
    meetingChatNav({ filesEnabled: enabled }),
  );
  const wrapper = (content: ReactNode) => (
    <QueryClientProvider client={client}>
      <TooltipProvider>{content}</TooltipProvider>
    </QueryClientProvider>
  );
  const result = render(wrapper(children));
  return {
    ...result,
    update: (content: ReactNode) => result.rerender(wrapper(content)),
  };
}
function narrow() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

describe("room file navigation integration", () => {
  it.each(["channel", "voice", "dm", "group", "meeting", "compact"] as const)(
    "opens files only on demand in %s",
    async (kind) => {
      const content =
        kind === "dm" ? (
          <DirectMessageScreen data={direct} />
        ) : kind === "group" ? (
          <DirectMessageScreen data={group} />
        ) : kind === "meeting" || kind === "compact" ? (
          <MeetingScreen
            data={source}
            variant={kind === "compact" ? "sheet" : "page"}
          />
        ) : (
          <ChannelScreen
            data={
              kind === "voice"
                ? { ...channel, room: { ...channel.room, kind: "voice" } }
                : channel
            }
          />
        );
      renderScreen(content);
      expect(fetchRoomFiles).not.toHaveBeenCalled();
      const trigger = screen.getByRole("button", { name: "파일" });
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      fireEvent.click(trigger);
      expect(await screen.findByText("리뷰 자료.pdf")).toBeInTheDocument();
      expect(fetchRoomFiles).toHaveBeenCalledTimes(1);
      expect(fetchRoomFiles).toHaveBeenCalledWith(
        source.room.id,
        expect.objectContaining({
          kind: "all",
          signal: expect.any(AbortSignal),
        }),
      );
      if (kind === "compact")
        expect(screen.getByRole("dialog", { name: "파일" })).toHaveAttribute(
          "data-side",
          "bottom",
        );
      else
        expect(
          screen.getByRole("complementary", { name: "파일" }),
        ).toBeInTheDocument();
    },
  );
  it("uses a bottom sheet on a narrow screen and returns focus to the persistent file trigger", async () => {
    narrow();
    const user = userEvent.setup();
    renderScreen(<ChannelScreen data={channel} />);
    const trigger = screen.getByRole("button", { name: "파일" });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: "파일" })).toHaveAttribute(
      "data-side",
      "bottom",
    );
    await user.click(screen.getByRole("button", { name: "파일 목록 닫기" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(trigger).toHaveFocus();
  });
  it("reads and lists existing files even when downloads and new uploads are disabled", async () => {
    renderScreen(<ChannelScreen data={channel} />, false);
    expect(
      screen.getByRole("button", { name: "파일 공유는 준비 중이에요" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "파일" }));
    const panel = await screen.findByRole("region", { name: "공유한 파일" });
    expect(await within(panel).findByText("리뷰 자료.pdf")).toBeInTheDocument();
    expect(
      within(panel).getByText("지금은 받을 수 없어요"),
    ).toBeInTheDocument();
    expect(within(panel).queryByRole("link")).not.toBeInTheDocument();
    expect(fetchRoomFiles).toHaveBeenCalledTimes(1);
  });
  it("shows only members or files at a time without recreating the message input", async () => {
    renderScreen(<ChannelScreen data={channel} />);
    const input = screen.getByRole("combobox", { name: "메시지" });
    fireEvent.change(input, { target: { value: "남아 있는 초안" } });
    fireEvent.click(screen.getByRole("button", { name: /멤버/ }));
    expect(
      screen.getByRole("complementary", { name: "채널 멤버" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "파일" }));
    expect(
      screen.queryByRole("complementary", { name: "채널 멤버" }),
    ).not.toBeInTheDocument();
    expect(await screen.findByText("리뷰 자료.pdf")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /멤버/ }));
    expect(
      screen.queryByRole("complementary", { name: "파일" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "메시지" })).toBe(input);
    expect(input).toHaveValue("남아 있는 초안");
  });
  it("does not show a late old-room response or carry an open file panel into a new room", async () => {
    const old = deferred<RoomFilesPage>();
    vi.mocked(fetchRoomFiles)
      .mockReturnValueOnce(old.promise)
      .mockResolvedValueOnce(page("새 방 자료.pdf"));
    const { update } = renderScreen(<ChannelScreen data={channel} />);
    fireEvent.click(screen.getByRole("button", { name: "파일" }));
    await waitFor(() => expect(fetchRoomFiles).toHaveBeenCalledTimes(1));
    const previousSignal = vi.mocked(fetchRoomFiles).mock.calls[0]![1].signal;
    update(
      <ChannelScreen
        data={{
          ...channel,
          room: { ...channel.room, id: "another-room", name: "새 방" },
        }}
      />,
    );
    expect(previousSignal?.aborted).toBe(true);
    expect(
      screen.queryByRole("region", { name: "공유한 파일" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "파일" }));
    expect(await screen.findByText("새 방 자료.pdf")).toBeInTheDocument();
    await act(async () => old.resolve(page("이전 방의 늦은 파일.pdf")));
    expect(
      screen.queryByText("이전 방의 늦은 파일.pdf"),
    ).not.toBeInTheDocument();
  });
  it("jumps to a message without losing booking selection, calendar parameters or hash", async () => {
    window.history.replaceState(
      null,
      "",
      `/bookings?month=2026-10&day=2026-10-08&meeting=${source.booking.id}&view=calendar#calendar`,
    );
    const user = userEvent.setup();
    const { container } = renderScreen(
      <MeetingScreen data={source} variant="sheet" />,
    );
    const message = await waitFor(() => {
      const element = container.querySelector<HTMLElement>(
        `[data-message-id="${source.messages[0]!.id}"] article`,
      );
      expect(element).not.toBeNull();
      return element!;
    });
    await user.click(screen.getByRole("button", { name: "파일" }));
    await user.click(
      await screen.findByRole("button", {
        name: "리뷰 자료.pdf 메시지로 가기",
      }),
    );
    const url = new URL(window.location.href);
    expect(url.pathname).toBe("/bookings");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      month: "2026-10",
      day: "2026-10-08",
      meeting: source.booking.id,
      view: "calendar",
      message: source.messages[0]!.id,
    });
    expect(url.hash).toBe("#calendar");
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "파일" }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(message).toHaveFocus());
  });
});
