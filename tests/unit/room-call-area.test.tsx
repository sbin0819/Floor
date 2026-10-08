import { Activity, useEffect, type ReactNode } from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RoomCallArea,
  RoomCallBoundary,
} from "@/features/calls/components/room-call-area";
import type { useCall } from "@/features/calls/components/call-provider";
import type { CallTarget } from "@/features/calls/client/types";
import type { CallView } from "@/features/calls/types";
import type { RealtimeEvent } from "@/lib/realtime/types";

const mocks = vi.hoisted(() => ({
  call: vi.fn(),
  available: true,
  target: vi.fn(),
  router: { refresh: vi.fn(), push: vi.fn() },
  listeners: new Map<string, (event: RealtimeEvent) => void>(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/features/calls/components/call-provider", () => ({
  useCall: mocks.call,
  useHasCallProvider: () => mocks.available,
  CallTargetSync: ({ target }: { target: CallTarget }) => {
    mocks.target(target);
    return null;
  },
  CallFailureNotice: () => <span>실패 안내 자리</span>,
}));
vi.mock("@/components/realtime-provider", () => ({
  useRealtimeChannel: (
    channel: string | null,
    receive: (event: RealtimeEvent) => void,
  ) => {
    useEffect(() => {
      if (!channel) return;
      mocks.listeners.set(channel, receive);
      return () => {
        mocks.listeners.delete(channel);
      };
    }, [channel, receive]);
  },
}));
type CallState = ReturnType<typeof useCall>;
let state: CallState;
function target(
  kind: CallTarget["roomKind"] = "text",
  roomId = "room-a",
): CallTarget {
  return {
    roomId,
    roomKind: kind,
    name: "가상 회의실",
    href: `/s/space/${roomId}`,
    participants: [],
  };
}
function snapshot(): CallView {
  return {
    sessionId: "session-a",
    kind: "huddle",
    startedAt: "2026-10-09T03:00:00.000Z",
    participantCount: 4,
    participants: ["김하은", "박지훈", "이서연", "정유나"].map(
      (name, index) => ({ userId: `user-${index}`, name }),
    ),
  };
}
function active(next = target(), participantId = "participant-me") {
  state.phase = "connected";
  state.call = {
    ...next,
    participantId,
    sessionId: "session-a",
    kind: next.roomKind === "voice" ? "voice" : "huddle",
    joinedAt: 0,
  };
  state.participants = [
    {
      userId: "me",
      participantId,
      name: "김하은",
      local: true,
      speaking: false,
      microphoneEnabled: true,
      cameraEnabled: false,
      screenShareEnabled: false,
      tracks: [],
    },
  ];
}
function event(
  extra: Partial<Extract<RealtimeEvent, { type: "call.changed" }>> = {},
): RealtimeEvent {
  return {
    type: "call.changed",
    roomId: "room-a",
    roomKind: "text",
    spaceId: "space",
    bookingId: null,
    sessionId: "session-a",
    kind: "huddle",
    participantCount: 1,
    participants: [{ userId: "other", name: "박지훈" }],
    ...extra,
  };
}
function emit(value = event(), channel = "room:room-a") {
  act(() => mocks.listeners.get(channel)?.(value));
}
function view({
  next = target(),
  initialCall = null,
  canCall = true,
  children = (
    <label>
      메시지
      <input aria-label="메시지" defaultValue="초안" />
    </label>
  ),
}: {
  next?: CallTarget;
  initialCall?: CallView | null;
  canCall?: boolean;
  children?: ReactNode;
} = {}) {
  return (
    <RoomCallArea target={next} initialCall={initialCall} canCall={canCall}>
      {children}
    </RoomCallArea>
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.available = true;
  mocks.listeners.clear();
  state = {
    phase: "idle",
    call: null,
    participants: [],
    remoteAudioTracks: [],
    microphoneEnabled: true,
    cameraEnabled: false,
    screenShareEnabled: false,
    audioAllowed: true,
    reducedQuality: false,
    silencePrompt: false,
    notice: null,
    check: null,
    restore: null,
    join: vi.fn(async () => {}),
    leave: vi.fn(async () => {}),
    toggleMicrophone: vi.fn(async () => {}),
    toggleCamera: vi.fn(async () => {}),
    toggleScreenShare: vi.fn(async () => {}),
    openDeviceCheck: vi.fn(),
    startAudio: vi.fn(async () => {}),
    keepStaying: vi.fn(),
    updateTarget: vi.fn(),
  };
  mocks.call.mockImplementation(() => state);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("persistent room call presentation", () => {
  it("keeps story or isolated page content usable outside the optional call provider", () => {
    mocks.available = false;
    const { container, rerender } = render(
      <RoomCallBoundary target={target()} initialCall={null} canCall={false}>
        <input aria-label="본문" />
      </RoomCallBoundary>,
    );
    expect(screen.getByRole("textbox", { name: "본문" })).toBeInTheDocument();
    expect(container.querySelector("[data-call-room]")).toHaveClass(
      "h-[calc(100dvh-3.5rem)]",
    );
    rerender(
      <RoomCallBoundary
        target={target()}
        initialCall={null}
        canCall={false}
        compact
      >
        <input aria-label="본문" />
      </RoomCallBoundary>,
    );
    expect(container.querySelector("[data-call-room]")).toHaveClass("h-full");
    expect(container.querySelector("[data-call-room]")).not.toHaveClass(
      "h-[calc(100dvh-3.5rem)]",
    );
    expect(mocks.call).not.toHaveBeenCalled();
    expect(mocks.listeners.size).toBe(0);
  });
  it("does not recreate message input when calling eligibility changes", () => {
    const node = (canCall: boolean) => (
      <RoomCallBoundary target={target()} initialCall={null} canCall={canCall}>
        <input aria-label="본문" />
      </RoomCallBoundary>
    );
    const { rerender } = render(node(false));
    const input = screen.getByRole("textbox", { name: "본문" });
    input.focus();
    fireEvent.change(input, { target: { value: "유지할 초안" } });
    rerender(node(true));
    expect(screen.getByRole("textbox", { name: "본문" })).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("유지할 초안");
    rerender(node(false));
    expect(screen.getByRole("textbox", { name: "본문" })).toBe(input);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("유지할 초안");
  });
  it("offers a voice entry outside a call and forwards only its known target", () => {
    const next = target("voice");
    render(view({ next }));
    expect(
      screen.getByRole("region", { name: "통화 화면" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: next.name }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("아직 통화 중인 사람이 없어요"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "들어가기" }));
    expect(state.join).toHaveBeenCalledExactlyOnceWith(next);
    expect(mocks.target).toHaveBeenCalledWith(next);
  });
  it("shows voice tiles and shared controls only for my connection to that room", () => {
    const next = target("voice");
    active(next);
    render(view({ next }));
    expect(
      screen.getByRole("region", { name: "김하은, 나" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "마이크 끄기" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "들어가기" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "통화 화면 닫기" }),
    ).not.toBeInTheDocument();
    expect(mocks.router.refresh).toHaveBeenCalledOnce();
  });
  it("does not display a different room's local roster as this voice call", () => {
    active(target("voice", "another-room"));
    render(view({ next: target("voice") }));
    expect(
      screen.queryByRole("region", { name: "김하은, 나" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "들어가기" }),
    ).toBeInTheDocument();
    expect(mocks.router.refresh).not.toHaveBeenCalled();
  });
  it("explains disabled voice access without invoking join", () => {
    render(view({ next: target("voice"), canCall: false }));
    expect(screen.getByText("통화를 쓸 수 없어요")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "참여" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "들어가기" }),
    ).not.toBeInTheDocument();
    expect(state.join).not.toHaveBeenCalled();
  });
  it.each(["text", "dm", "group_dm", "meeting"] as const)(
    "starts %s with a ringing hint only for a new DM",
    (kind) => {
      const next = target(kind);
      render(view({ next }));
      expect(
        screen.queryByRole("region", { name: "통화 화면" }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "통화 시작" }));
      expect(state.join).toHaveBeenCalledExactlyOnceWith(
        kind === "dm" ? { ...next, ringing: true } : next,
      );
    },
  );
  it("joins an existing DM without restarting ringing and shows at most three supplied avatars", () => {
    const next = target("dm");
    render(view({ next, initialCall: snapshot() }));
    expect(screen.getByText("통화 중 · 4명")).toBeInTheDocument();
    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(
      screen.queryByRole("img", { name: "정유나" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "참여" }));
    expect(state.join).toHaveBeenCalledExactlyOnceWith(next);
  });
  it("shows a lounge count with no invented participant names", () => {
    render(view({ initialCall: { ...snapshot(), participants: [] } }));
    expect(screen.getByText("통화 중 · 4명")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
  it("does not call a stale-only snapshot ongoing or reuse its roster", () => {
    render(view({ initialCall: { ...snapshot(), participantCount: 0 } }));
    expect(screen.queryByText(/통화 중 ·/)).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "통화 시작" }),
    ).toBeInTheDocument();
  });
  it("removes ongoing status when all participants become stale before the session ends", () => {
    render(view({ initialCall: snapshot() }));
    expect(screen.getByText("통화 중 · 4명")).toBeInTheDocument();
    emit(event({ participantCount: 0, participants: [] }));
    expect(screen.queryByText(/통화 중 ·/)).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "통화 시작" }),
    ).toBeInTheDocument();
  });
  it("does not offer a new call when the room is read-only", () => {
    render(view({ canCall: false }));
    expect(
      screen.queryByRole("button", { name: /통화 시작|참여/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "메시지" })).toBeInTheDocument();
  });
  it("keeps one message DOM and its draft when a huddle opens, closes, and reopens", () => {
    const next = target();
    const { rerender, container } = render(view({ next }));
    const input = screen.getByRole("textbox", { name: "메시지" });
    fireEvent.change(input, { target: { value: "남겨 둔 초안" } });
    active(next);
    rerender(view({ next }));
    expect(
      container.querySelectorAll('input[aria-label="메시지"]'),
    ).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "메시지", hidden: true })).toBe(
      input,
    );
    fireEvent.click(screen.getByRole("button", { name: "통화 화면 닫기" }));
    expect(screen.getByRole("textbox", { name: "메시지" })).toBe(input);
    expect(input).toHaveValue("남겨 둔 초안");
    expect(state.leave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "통화 화면으로" }));
    expect(
      screen.getByRole("region", { name: "통화 화면" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "메시지", hidden: true })).toBe(
      input,
    );
    expect(state.join).not.toHaveBeenCalled();
    expect(state.leave).not.toHaveBeenCalled();
  });
  it("changes the mobile tab without remounting message content or disconnecting", () => {
    active(target("voice"));
    const { container } = render(view({ next: target("voice") }));
    const input = screen.getByRole("textbox", { name: "메시지", hidden: true });
    const call = screen.getByRole("region", { name: "통화 화면" });
    fireEvent.click(screen.getByRole("button", { name: "채팅 보기" }));
    expect(call).toHaveClass("hidden", "xl:flex");
    expect(screen.getByRole("button", { name: "통화 보기" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.change(input, { target: { value: "계속 작성" } });
    fireEvent.click(screen.getByRole("button", { name: "통화 보기" }));
    expect(call).not.toHaveClass("hidden");
    expect(input).toHaveValue("계속 작성");
    expect(container.querySelectorAll("input")).toHaveLength(1);
    expect(state.leave).not.toHaveBeenCalled();
  });
  it("expands and collapses the desktop side chat while retaining one input", () => {
    active();
    const { container } = render(view());
    const input = screen.getByRole("textbox", { name: "메시지", hidden: true });
    const button = screen.getByRole("button", { name: "채팅 열기" });
    expect(button).toHaveClass("hidden", "xl:flex");
    fireEvent.click(button);
    expect(screen.getByRole("button", { name: "채팅 접기" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(input.closest("label")?.parentElement).toHaveClass(
      "xl:w-[360px]",
      "xl:flex",
    );
    fireEvent.click(screen.getByRole("button", { name: "채팅 접기" }));
    expect(input.closest("label")?.parentElement).toHaveClass("hidden");
    expect(container.querySelectorAll("input")).toHaveLength(1);
    expect(state.leave).not.toHaveBeenCalled();
  });
  it("coalesces realtime changes into one refresh and immediately replaces the visible count", () => {
    vi.useFakeTimers();
    render(view());
    emit(event({ participantCount: 2 }));
    emit(event({ participantCount: 3 }));
    expect(screen.getByText("통화 중 · 3명")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(249));
    expect(mocks.router.refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(mocks.router.refresh).toHaveBeenCalledOnce();
    emit(event({ sessionId: null, participantCount: 0, participants: [] }));
    expect(screen.queryByText(/통화 중 ·/)).not.toBeInTheDocument();
    act(() => vi.advanceTimersByTime(250));
    expect(mocks.router.refresh).toHaveBeenCalledTimes(2);
  });
  it("does not react to events for another room or a different event kind", () => {
    vi.useFakeTimers();
    render(view());
    emit(event({ roomId: "room-b" }));
    emit({ type: "call.declined", roomId: "room-a", sessionId: "session-a" });
    act(() => vi.advanceTimersByTime(1000));
    expect(screen.queryByText(/통화 중 ·/)).not.toBeInTheDocument();
    expect(mocks.router.refresh).not.toHaveBeenCalled();
  });
  it("reconciles a fresh server snapshot after a streamed realtime update", () => {
    const { rerender } = render(view());
    emit(event());
    expect(screen.getByText("통화 중 · 1명")).toBeInTheDocument();
    rerender(view({ initialCall: snapshot() }));
    expect(screen.getByText("통화 중 · 4명")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "김하은" })).toBeInTheDocument();
  });
  it("does not show another room's last event when navigating between two initially empty rooms", () => {
    const { rerender } = render(view());
    emit(event());
    expect(screen.getByText("통화 중 · 1명")).toBeInTheDocument();
    rerender(view({ next: target("text", "room-b") }));
    expect(screen.queryByText(/통화 중 ·/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("img", { name: "박지훈" }),
    ).not.toBeInTheDocument();
    expect(mocks.listeners.has("room:room-a")).toBe(false);
    expect(mocks.listeners.has("room:room-b")).toBe(true);
  });
  it("refreshes once for each new local participant, not ordinary media changes", () => {
    active();
    const { rerender } = render(view());
    expect(mocks.router.refresh).toHaveBeenCalledOnce();
    state.microphoneEnabled = false;
    rerender(view());
    expect(mocks.router.refresh).toHaveBeenCalledOnce();
    active(target(), "replacement");
    rerender(view());
    expect(mocks.router.refresh).toHaveBeenCalledTimes(2);
    state.call = null;
    state.phase = "idle";
    rerender(view());
    expect(mocks.router.refresh).toHaveBeenCalledTimes(2);
  });
  it("clears pending refreshes and subscriptions on unmount", () => {
    vi.useFakeTimers();
    const { unmount } = render(view());
    emit(event());
    unmount();
    act(() => vi.advanceTimersByTime(1000));
    expect(mocks.router.refresh).not.toHaveBeenCalled();
    expect(mocks.listeners.size).toBe(0);
  });
  it("does not let an old route's pending refresh run against the next room", () => {
    vi.useFakeTimers();
    const { rerender } = render(view());
    emit(event());
    rerender(view({ next: target("text", "room-b") }));
    act(() => vi.advanceTimersByTime(250));
    expect(mocks.router.refresh).not.toHaveBeenCalled();
    emit(event({ roomId: "room-b" }), "room:room-b");
    act(() => vi.advanceTimersByTime(250));
    expect(mocks.router.refresh).toHaveBeenCalledOnce();
  });
  it("cancels hidden Activity work and resumes coalesced refresh after restoration", () => {
    vi.useFakeTimers();
    const node = (hidden: boolean) => (
      <Activity mode={hidden ? "hidden" : "visible"}>{view()}</Activity>
    );
    const { rerender } = render(node(false));
    emit(event());
    rerender(node(true));
    act(() => vi.advanceTimersByTime(1000));
    expect(mocks.router.refresh).not.toHaveBeenCalled();
    expect(mocks.listeners.size).toBe(0);
    rerender(node(false));
    emit(event({ participantCount: 2 }));
    act(() => vi.advanceTimersByTime(250));
    expect(mocks.router.refresh).toHaveBeenCalledOnce();
    expect(screen.getByText("통화 중 · 2명")).toBeInTheDocument();
  });
  it("keeps the compact meeting sheet inside its parent's height without duplicating the message region", () => {
    const { container } = render(
      <RoomCallArea
        compact
        target={target("meeting")}
        initialCall={null}
        canCall
      >
        <section aria-label="회의 채팅">본문</section>
      </RoomCallArea>,
    );
    expect(container.querySelector("[data-call-room]")).toHaveClass("h-full");
    expect(
      within(container).getAllByRole("region", { name: "회의 채팅" }),
    ).toHaveLength(1);
  });
});
