import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeEvent } from "@/lib/realtime/types";
import type { PresenceMember } from "@/lib/realtime/ably-browser-client";
import type { ActionResult } from "@/lib/actions/result";
import type { ChannelView, ChatMessage } from "@/features/chat/types";
import { emptyMessageDetails } from "@/features/chat/types";
import { ChannelScreen } from "@/features/chat/components/channel-screen";
import { ChannelSkeleton } from "@/features/chat/components/channel-skeleton";
import { MessageComposer } from "@/features/chat/components/message-composer";
import { MessageList } from "@/features/chat/components/message-list";
import {
  roomMessagesKey,
  type DisplayMessage,
} from "@/features/chat/components/message-state";
import type { SendChatMessage } from "@/features/chat/components/use-channel-messages";
import { setRoomMuted } from "@/features/chat/actions";
import { installChatViewport } from "../helpers/chat-viewport";
import { fetchRoomMessagesPage } from "@/features/chat/client";

const realtime = vi.hoisted(() => ({
  event: vi.fn<(event: RealtimeEvent) => void>() as (
    event: RealtimeEvent,
  ) => void,
  connection: "disabled",
  refresh: vi.fn(),
  presenceUpdate: vi.fn(),
  presenceReceive: vi.fn() as (members: readonly PresenceMember[]) => void,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: realtime.refresh }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/features/chat/actions", () => ({
  sendMessage: vi.fn(),
  setReaction: vi.fn(),
  editMessage: vi.fn(),
  deleteMessage: vi.fn(),
  setRoomMuted: vi.fn(async () => ({ ok: true, data: undefined })),
  setSpaceMuted: vi.fn(),
  markRoomRead: vi.fn(async ({ seq }: { seq: number }) => ({
    ok: true,
    data: { lastReadSeq: seq },
  })),
}));
vi.mock("@/features/chat/client", () => ({ fetchRoomMessagesPage: vi.fn() }));
vi.mock("@/components/realtime-provider", () => ({
  useRealtimeScope: () => ({ channels: null, requestedRooms: [] }),
  usePresenceStatus: () => "unknown",
  usePresenceStatuses: () => ({}),
  useRealtimeChannel: (_channel: string, onEvent: typeof realtime.event) => {
    realtime.event = onEvent;
  },
  useRealtimeConnectionState: () => realtime.connection,
  useRealtimeLifecycle: () => {},
  useRealtimePresence: (
    _channel: string | null,
    receive: typeof realtime.presenceReceive,
  ) => {
    realtime.presenceReceive = receive;
    return realtime.presenceUpdate;
  },
}));

const now = "2026-10-08T03:00:00Z";
function message(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    authorAvatar: { color: "blue" as const, photoUrl: null },
    ...emptyMessageDetails(),
    id: "message",
    seq: 1,
    authorId: "me",
    authorName: "박지훈",
    kind: "text",
    body: "안녕하세요",
    createdAt: "2026-10-08T00:12:00Z",
    clientId: null,
    ...overrides,
  };
}
function created(
  message: ChatMessage,
): Extract<RealtimeEvent, { type: "message.created" }> {
  return {
    ...message,
    type: "message.created",
    roomId: "room",
    editedAt: null,
    deletedAt: null,
    reactions: [],
  };
}
function view(overrides: Partial<ChannelView> = {}): ChannelView {
  return {
    call: null,
    canCall: false,
    space: { id: "space", name: "디자인팀", muted: false },
    room: {
      kind: "text",
      id: "room",
      name: "일반",
      topic: "디자인팀 전체 이야기",
      archived: false,
      adminOnly: false,
      lastSeq: 1,
      muted: false,
      unreadMentions: 0,
    },
    user: {
      avatar: { color: "blue" as const, photoUrl: null },
      id: "me",
      name: "박지훈",
    },
    members: [
      {
        avatar: { color: "blue" as const, photoUrl: null },
        id: "me",
        name: "박지훈",
        admin: true,
      },
      {
        avatar: { color: "blue" as const, photoUrl: null },
        id: "other",
        name: "이서연",
        admin: false,
      },
    ],
    messages: [message()],
    canWrite: true,
    lastReadSeq: null,
    firstUnreadSeq: null,
    now,
    ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function setup(data = view(), send: SendChatMessage = vi.fn()) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(["chat", "nav"], {
    chatToasts: true,
    tabBadge: true,
    filesEnabled: false,
    callsEnabled: false,
    calls: [],
    myCall: null,
    spaces: [],
    directMessages: [],
    myStatus: "online",
    blockedUserIds: [],
    meetings: [],
    now: "2026-10-08T03:00:00.000Z",
  });
  const renderView = (incoming: ChannelView) => (
    <QueryClientProvider client={client}>
      <ChannelScreen data={incoming} send={send} />
    </QueryClientProvider>
  );
  const result = render(renderView(data));
  return {
    ...result,
    client,
    update: (incoming: ChannelView) => result.rerender(renderView(incoming)),
  };
}

let restoreViewport: () => void;
beforeEach(() => {
  restoreViewport = installChatViewport();
  realtime.refresh.mockReset();
  realtime.connection = "disabled";
  realtime.presenceUpdate.mockReset();
  vi.mocked(setRoomMuted).mockClear();
  vi.mocked(fetchRoomMessagesPage).mockReset();
});
afterEach(() => {
  restoreViewport();
  vi.unstubAllGlobals();
});

describe("chat message composer", () => {
  it("sends trimmed text on Enter, clears the draft and leaves Shift+Enter alone", () => {
    const onSend = vi.fn();
    render(<MessageComposer channelName="일반" onSend={onSend} />);
    const input = screen.getByRole("combobox", { name: "메시지" });
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "  첫 줄\n다음 줄  " } });
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).toHaveBeenCalledWith("첫 줄\n다음 줄");
    expect(input).toHaveValue("");
  });
  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "does not send during Korean composition %j",
    (native) => {
      const onSend = vi.fn();
      render(<MessageComposer channelName="일반" onSend={onSend} />);
      const input = screen.getByRole("combobox", { name: "메시지" });
      fireEvent.change(input, { target: { value: "한글" } });
      fireEvent.keyDown(input, { key: "Enter", ...native });
      expect(onSend).not.toHaveBeenCalled();
      expect(input).toHaveValue("한글");
    },
  );
  it("counts Unicode code points and allows exactly 4000 but rejects 4001", () => {
    const onSend = vi.fn();
    render(<MessageComposer channelName="일반" onSend={onSend} />);
    const input = screen.getByRole("combobox", { name: "메시지" });
    expect(input).not.toHaveAttribute("maxlength");
    fireEvent.change(input, { target: { value: "😀".repeat(4000) } });
    expect(screen.getByText("0자 남았어요")).toHaveAttribute(
      "id",
      input.getAttribute("aria-describedby"),
    );
    expect(screen.getByRole("button", { name: "보내기" })).toBeEnabled();
    fireEvent.change(input, { target: { value: "😀".repeat(4001) } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe("chat channel presentation", () => {
  it("merges and announces a new system row from a server refresh without an extra message event", async () => {
    const initial = view();
    const { update, container } = setup(initial);
    const row = message({
      id: "system-added",
      seq: initial.room.lastSeq + 1,
      authorId: null,
      authorName: null,
      kind: "system",
      systemData: { type: "member_left", name: "이서연" },
      body: "이서연 님이 나갔어요",
    });
    const refreshed = {
      ...initial,
      room: { ...initial.room, lastSeq: row.seq },
      messages: [...initial.messages, row],
    };
    update(refreshed);
    await waitFor(() =>
      expect(
        container.querySelector("[data-chat-announcement]"),
      ).toHaveTextContent("시스템: 이서연 님이 나갔어요"),
    );
    expect(screen.getByRole("article", { name: /시스템/ })).toHaveTextContent(
      "이서연 님이 나갔어요",
    );
    const announcement = container.querySelector(
      "[data-chat-announcement]",
    )!.firstChild;
    update({ ...refreshed, messages: [...refreshed.messages] });
    await act(async () => {});
    expect(
      container.querySelector("[data-chat-announcement]")!.firstChild,
    ).toBe(announcement);
  });
  it("renders its fixed header and stable composer while block metadata is still unknown", async () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <ChannelScreen data={view()} send={vi.fn()} />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { name: "일반" })).toBeVisible();
    const input = screen.getByRole("combobox", { name: "메시지" });
    expect(
      screen.getByRole("status", {
        name: "메시지 표시 정보를 불러오고 있어요",
      }),
    ).toBeVisible();
    expect(screen.queryByText("안녕하세요")).not.toBeInTheDocument();
    await act(async () => {
      client.setQueryData(["chat", "nav"], {
        chatToasts: true,
        tabBadge: true,
        filesEnabled: false,
        callsEnabled: false,
        calls: [],
        myCall: null,
        spaces: [],
        directMessages: [],
        myStatus: "online",
        blockedUserIds: [],
        meetings: [],
        now: "2026-10-08T03:00:00.000Z",
      });
    });
    expect(await screen.findByText("안녕하세요")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "메시지" })).toBe(input);
  });
  it("offers the current channel mute setting in its header and refreshes only after success", async () => {
    setup();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "일반 알림 설정" }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "알림 끄기" }));
    await waitFor(() =>
      expect(setRoomMuted).toHaveBeenCalledWith({
        roomId: "room",
        muted: true,
      }),
    );
    await waitFor(() => expect(realtime.refresh).toHaveBeenCalledOnce());
  });
  it("wires typing to the composer and clears it when sending", () => {
    setup(view(), async (input) => ({
      ok: true,
      data: message({ body: input.body, clientId: input.clientId }),
    }));
    fireEvent.change(screen.getByRole("combobox", { name: "메시지" }), {
      target: { value: "안녕" },
    });
    expect(realtime.presenceUpdate).toHaveBeenCalledWith({
      typing: true,
      name: "박지훈",
    });
    fireEvent.keyDown(screen.getByRole("combobox", { name: "메시지" }), {
      key: "Enter",
    });
    expect(realtime.presenceUpdate).toHaveBeenLastCalledWith({ typing: false });
  });
  it("shows verified typing names even to a read-only channel member", () => {
    const { container } = setup(view({ canWrite: false }));
    act(() =>
      realtime.presenceReceive([
        {
          clientId: "other",
          connectionId: "tab",
          timestamp: Date.now(),
          data: { typing: true, name: "믿지 않는 이름" },
        },
      ]),
    );
    expect(container.querySelector("[data-chat-typing]")).toHaveTextContent(
      "이서연 님이 입력하고 있어요",
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
  it("shows one mobile member sheet and returns focus to its trigger", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    );
    setup();
    const trigger = screen.getByRole("button", { name: "멤버 2명" });
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByRole("dialog", { name: "채널 멤버" })).toBeVisible();
    expect(screen.getAllByRole("list", { name: "팀원 목록" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "멤버 목록 닫기" }));
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it("shows only real channel fields and a team member panel without online status", () => {
    const { container } = setup();
    expect(screen.getByRole("heading", { name: "일반" })).toBeVisible();
    expect(container.querySelector("[data-chat-screen]")).toHaveClass("h-full");
    expect(container.querySelector("[data-call-room]")).toHaveClass(
      "h-[calc(100dvh-3.5rem)]",
    );
    expect(screen.getByRole("region", { name: "일반 메시지" })).toHaveAttribute(
      "aria-live",
      "off",
    );
    fireEvent.click(screen.getByRole("button", { name: "멤버 2명" }));
    const members = screen.getByRole("list", { name: "팀원 목록" });
    expect(within(members).getByText("이서연")).toBeVisible();
    expect(within(members).getByText("관리자")).toBeVisible();
    expect(screen.queryByText("온라인")).not.toBeInTheDocument();
  });
  it("renders a structurally matching skeleton without guessing a channel name or count", () => {
    const { container } = render(<ChannelSkeleton />);
    expect(container.querySelector("[data-chat-screen]")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
  it("groups author headings but renders HTML and newlines as plain text", () => {
    setup(
      view({
        messages: [
          message({ body: "<script>bad()</script>\n둘째 줄" }),
          message({
            id: "second",
            seq: 2,
            body: "후속",
            createdAt: "2026-10-08T00:17:00Z",
          }),
          message({
            id: "third",
            seq: 3,
            body: "다음 묶음",
            createdAt: "2026-10-08T00:22:01Z",
          }),
        ],
      }),
    );
    const log = screen.getByRole("region", { name: "일반 메시지" });
    expect(log.querySelector("script")).toBeNull();
    expect(log.querySelectorAll('article[data-run-start="true"]')).toHaveLength(
      2,
    );
    expect(log.textContent).toContain("<script>bad()</script>\n둘째 줄");
    expect(within(log).getByText("오늘")).toBeVisible();
  });
  it.each([true, false])(
    "replaces input with the readonly notice (archived=%s)",
    (archived) => {
      const data = view();
      setup({
        ...data,
        canWrite: false,
        room: { ...data.room, archived, adminOnly: !archived },
      });
      expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
      expect(
        screen.getByText(
          archived ? "보관된 채널이에요" : "이 채널에는 관리자만 쓸 수 있어요",
        ),
      ).toBeVisible();
    },
  );
  it("shows disconnected feedback, but no banner when realtime is disabled", () => {
    realtime.connection = "disconnected";
    const result = setup();
    expect(
      screen.getByText("연결이 끊겼어요. 다시 연결하고 있어요"),
    ).toBeVisible();
    realtime.connection = "disabled";
    result.update(view());
    expect(
      screen.queryByText("연결이 끊겼어요. 다시 연결하고 있어요"),
    ).not.toBeInTheDocument();
  });
});

describe("optimistic sending and streamed updates", () => {
  it("keeps an expired-session failure with a login link instead of replaying it", async () => {
    const send = vi
      .fn<SendChatMessage>()
      .mockResolvedValue({ ok: false, code: "UNAUTHENTICATED" });
    setup(view({ messages: [] }), send);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "세션 만료 메시지" },
    });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(await screen.findByText("로그인이 풀렸어요")).toBeVisible();
    expect(screen.getByRole("link", { name: "로그인" })).toHaveAttribute(
      "href",
      "/login",
    );
    expect(
      screen.queryByRole("button", { name: "다시 보내기" }),
    ).not.toBeInTheDocument();
    expect(send).toHaveBeenCalledOnce();
  });
  it("applies a late send result only to the room where it was submitted", async () => {
    const pending = deferred<ActionResult<ChatMessage>>();
    const send = vi.fn<SendChatMessage>(() => pending.promise);
    const result = setup(view({ messages: [] }), send);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "이전 방 메시지" },
    });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    const next = view({ messages: [] });
    result.update({
      ...next,
      room: { ...next.room, id: "other-room", name: "다른 채널", lastSeq: 0 },
    });
    await act(async () => {
      pending.resolve({
        ok: true,
        data: message({
          body: "이전 방 메시지",
          clientId: send.mock.calls[0]![0].clientId,
        }),
      });
    });
    await waitFor(() =>
      expect(
        result.client.getQueryData<DisplayMessage[]>(
          roomMessagesKey("room"),
        )?.[0]?.delivery,
      ).toBeUndefined(),
    );
    expect(result.client.getQueryData(roomMessagesKey("other-room"))).toEqual(
      [],
    );
    expect(screen.queryByText("이전 방 메시지")).not.toBeInTheDocument();
  });
  it("keeps the optimistic DOM node and client key when action and realtime both acknowledge", async () => {
    const pending = deferred<ActionResult<ChatMessage>>();
    const send = vi.fn<SendChatMessage>(() => pending.promise);
    const { container } = setup(view({ messages: [] }), send);
    const input = screen.getByRole("combobox", { name: "메시지" });
    fireEvent.change(input, { target: { value: "첫 메시지" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    const submitted = send.mock.calls[0]![0];
    const node = container.querySelector(
      `[data-message-key="${submitted.clientId}"]`,
    );
    expect(node?.querySelector("article")).toHaveAttribute(
      "data-delivery",
      "pending",
    );
    expect(node?.querySelector("article")).toHaveAttribute(
      "data-bubble-state",
      "pending",
    );
    expect(input).toHaveValue("");
    const saved = message({
      id: "saved",
      body: submitted.body,
      clientId: submitted.clientId,
    });
    act(() => realtime.event(created(saved)));
    await act(async () => {
      pending.resolve({ ok: true, data: saved });
    });
    await waitFor(() =>
      expect(node?.querySelector("article")).toHaveAttribute(
        "data-delivery",
        "sent",
      ),
    );
    expect(
      container.querySelector(`[data-message-key="${submitted.clientId}"]`),
    ).toBe(node);
    expect(screen.getAllByText("첫 메시지")).toHaveLength(1);
  });
  it("allows typing and queuing the next message while FIFO mutation waits for the first", async () => {
    const first = deferred<ActionResult<ChatMessage>>();
    const send = vi
      .fn<SendChatMessage>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async (input) => ({
        ok: true,
        data: message({
          id: "second",
          seq: 2,
          body: input.body,
          clientId: input.clientId,
        }),
      }));
    setup(view({ messages: [] }), send);
    const input = screen.getByRole("combobox", { name: "메시지" });
    fireEvent.change(input, { target: { value: "하나" } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    fireEvent.change(input, { target: { value: "둘" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toBeEnabled();
    await waitFor(() => expect(screen.getByText("둘")).toBeVisible());
    expect(send).toHaveBeenCalledOnce();
    await act(async () => {
      first.resolve({
        ok: true,
        data: message({
          id: "first",
          body: "하나",
          clientId: send.mock.calls[0]![0].clientId,
        }),
      });
    });
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls.map(([input]) => input.body)).toEqual([
      "하나",
      "둘",
    ]);
  });
  it("retains failed text and retries with the original clientId", async () => {
    const send = vi
      .fn<SendChatMessage>()
      .mockResolvedValueOnce({
        ok: false,
        code: "INTERNAL",
      })
      .mockImplementation(async (input) => ({
        ok: true,
        data: message({ body: input.body, clientId: input.clientId }),
      }));
    setup(view({ messages: [] }), send);
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "다시 보낼 내용" },
    });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(await screen.findByText("보내지 못했어요")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "다시 보내기" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
    expect(send.mock.calls[1]![0].clientId).toBe(
      send.mock.calls[0]![0].clientId,
    );
    await waitFor(() =>
      expect(screen.queryByText("보내지 못했어요")).not.toBeInTheDocument(),
    );
  });
  it("lets failed messages be removed and hides retry for inaccessible channels", async () => {
    setup(
      view({ messages: [] }),
      vi
        .fn<SendChatMessage>()
        .mockResolvedValue({ ok: false, code: "NOT_FOUND" }),
    );
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "보낼 수 없는 내용" },
    });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    expect(await screen.findByText("이 채널을 더 볼 수 없어요")).toBeVisible();
    expect(screen.getByRole("link", { name: "메시지 목록" })).toHaveAttribute(
      "href",
      "/messages",
    );
    expect(
      screen.queryByRole("button", { name: "다시 보내기" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "지우기" }));
    await waitFor(() =>
      expect(screen.queryByText("보낼 수 없는 내용")).not.toBeInTheDocument(),
    );
  });
  it("merges refreshed server rows and realtime order, deduplicates, and fills a sequence gap", async () => {
    const result = setup();
    const third = message({
      id: "third",
      seq: 3,
      body: "세 번째",
      authorId: "other",
    });
    const second = message({
      id: "second",
      seq: 2,
      body: "두 번째",
      authorId: "other",
    });
    vi.mocked(fetchRoomMessagesPage).mockResolvedValue({
      messages: [second, third],
      peerReadSeq: null,
      hasMore: false,
      lastSeq: 3,
      lastReadSeq: null,
      firstUnreadSeq: 2,
    });
    act(() => realtime.event(created(third)));
    await waitFor(() =>
      expect(fetchRoomMessagesPage).toHaveBeenCalledWith(
        "room",
        { after: 1 },
        expect.any(Object),
      ),
    );
    expect(realtime.refresh).not.toHaveBeenCalled();
    act(() => realtime.event(created(third)));
    result.update(view({ messages: [second, third] }));
    await waitFor(() => expect(screen.getByText("두 번째")).toBeVisible());
    expect(screen.getAllByText("세 번째")).toHaveLength(1);
    expect(
      result.client
        .getQueryData<DisplayMessage[]>(roomMessagesKey("room"))
        ?.map(({ seq }) => seq),
    ).toEqual([1, 2, 3]);
  });
  it("only follows new messages at the bottom and offers a counted explicit jump otherwise", async () => {
    const props = {
      channelName: "일반",
      now,
      userId: "me",
      onRetry: vi.fn(),
      onRemove: vi.fn(),
    };
    const initial = Array.from({ length: 30 }, (_, index) =>
      message({ id: `initial-${index}`, seq: index + 1, authorId: "other" }),
    );
    const result = render(<MessageList {...props} messages={initial} />);
    const log = screen.getByRole("region", { name: "일반 메시지" });
    await waitFor(() => expect(log.scrollTop).toBeGreaterThan(1000));
    fireEvent.scroll(log, { target: { scrollTop: 0 } });
    result.rerender(
      <MessageList
        {...props}
        messages={[
          ...initial,
          message({ id: "second", seq: 31, authorId: "other" }),
        ]}
      />,
    );
    expect(log.scrollTop).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "새 메시지 1개" }));
    await waitFor(() => expect(log.scrollTop).toBeGreaterThan(1000));
    expect(
      screen.queryByRole("button", { name: /새 메시지 \d+개/ }),
    ).not.toBeInTheDocument();
  });
});
