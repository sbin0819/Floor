import {
  act,
  fireEvent,
  render,
  screen,
  cleanup,
} from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster, toast } from "sonner";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RealtimeEvent } from "@/lib/realtime/types";
import type { CallSnapshot, CallTarget } from "@/features/calls/client/types";
import { CallRinging } from "@/features/calls/components/call-ringing";
import { CallingStatus } from "@/features/calls/components/calling-status";

const mocks = vi.hoisted(() => ({
  handlers: new Set<(event: RealtimeEvent) => void>(),
  snapshot: { call: null, participants: [] } as Pick<
    CallSnapshot,
    "call" | "participants"
  >,
  join: vi.fn<(target: CallTarget) => Promise<void>>(),
  decline: vi.fn(),
}));
vi.mock("@/features/calls/components/call-provider", () => ({
  useCall: () => ({ ...mocks.snapshot, join: mocks.join }),
}));
vi.mock("@/features/calls/actions", () => ({
  declineCall: mocks.decline,
}));
vi.mock("@/components/realtime-provider", () => ({
  useRealtimeChannel: (
    channel: string | null,
    receive: (event: RealtimeEvent) => void,
  ) => {
    useEffect(() => {
      if (!channel) return;
      mocks.handlers.add(receive);
      return () => {
        mocks.handlers.delete(receive);
      };
    }, [channel, receive]);
  },
}));
const ring = {
  type: "call.ringing",
  roomId: "room",
  sessionId: "session",
  callerId: "peer",
  callerName: "이서연",
} satisfies RealtimeEvent;
const changed = {
  type: "call.changed",
  roomId: "room",
  roomKind: "dm",
  spaceId: null,
  bookingId: null,
  sessionId: "session",
  kind: "huddle",
  participantCount: 1,
  participants: [{ userId: "peer", name: "이서연" }],
} satisfies RealtimeEvent;
function Provider({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      {children}
      <Toaster />
    </QueryClientProvider>
  );
}
function incoming(
  props: Partial<React.ComponentProps<typeof CallRinging>> = {},
) {
  return (
    <CallRinging
      userId="me"
      myStatus="online"
      blockedUserIds={[]}
      enabled
      {...props}
    />
  );
}
async function emit(event: RealtimeEvent) {
  await act(async () => {
    for (const receive of mocks.handlers) receive(event);
    await vi.advanceTimersByTimeAsync(20);
  });
}
async function advance(ms: number) {
  // Sonner는 dismiss를 다음 프레임에 전달하고 효과에서 퇴장 애니메이션을 시작한다.
  await act(async () => {
    vi.advanceTimersToNextFrame();
  });
  await act(async () => {
    vi.advanceTimersToNextFrame();
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_800_000_000_000);
  mocks.snapshot = { call: null, participants: [] };
  mocks.join.mockReset().mockResolvedValue();
  mocks.decline.mockReset().mockResolvedValue({ ok: true, data: {} });
});
afterEach(async () => {
  cleanup();
  toast.dismiss();
  if (vi.isFakeTimers()) await vi.runOnlyPendingTimersAsync();
  vi.useRealTimers();
  mocks.handlers.clear();
});

describe("incoming DM call", () => {
  it("uses a reachable nonmodal sonner dialog without moving focus", async () => {
    render(
      <>
        <button>기존 입력</button>
        {incoming()}
      </>,
      { wrapper: Provider },
    );
    screen.getByText("기존 입력").focus();
    await emit(ring);
    const dialog = screen.getByRole("dialog", { name: "이서연 님의 전화" });
    expect(dialog).toHaveAttribute("aria-modal", "false");
    expect(dialog.closest("[data-sonner-toast]")).not.toBeNull();
    expect(screen.getByText("기존 입력")).toHaveFocus();
    fireEvent.keyDown(document, { key: "t", code: "KeyT", altKey: true });
    expect(dialog.closest("[data-sonner-toaster]")).toHaveFocus();
    const take = screen.getByRole("button", { name: "받기" });
    take.focus();
    expect(take).toHaveFocus();
    fireEvent.click(take);
    await advance(300);
    expect(mocks.join).toHaveBeenCalledWith({
      roomId: "room",
      roomKind: "dm",
      name: "이서연",
      href: "/dm/room",
      participants: [{ userId: "peer", name: "이서연" }],
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("supports Sonner's keyboard shortcut followed by Tab into the answer controls", async () => {
    vi.useRealTimers();
    render(incoming(), { wrapper: Provider });
    act(() => {
      for (const receive of mocks.handlers) receive(ring);
    });
    await screen.findByRole("dialog", { name: "이서연 님의 전화" });
    fireEvent.keyDown(document, { key: "t", code: "KeyT", altKey: true });
    const keyboard = userEvent.setup();
    await keyboard.tab();
    expect(
      screen.getByRole("dialog").closest("[data-sonner-toast]"),
    ).toHaveFocus();
    await keyboard.tab();
    expect(screen.getByRole("button", { name: "받기" })).toHaveFocus();
    await keyboard.tab();
    expect(screen.getByRole("button", { name: "거절" })).toHaveFocus();
  });
  it("accepts during another call through the existing provider switch flow", async () => {
    mocks.snapshot.call = {
      roomId: "other",
      roomKind: "voice",
      name: "회의실",
      href: "/other",
      participants: [],
      participantId: "p",
      sessionId: "old",
      kind: "voice",
      joinedAt: 1_800_000_000_000,
    };
    render(incoming(), { wrapper: Provider });
    await emit(ring);
    fireEvent.click(screen.getByRole("button", { name: "받기" }));
    await advance(1);
    expect(mocks.join).toHaveBeenCalledTimes(1);
    expect(mocks.join.mock.calls[0]![0].roomId).toBe("room");
  });
  it("declines once, passing exactly one action argument", async () => {
    let finish!: (value: unknown) => void;
    mocks.decline.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(incoming(), { wrapper: Provider });
    await emit(ring);
    const button = screen.getByRole("button", { name: "거절" });
    fireEvent.click(button);
    fireEvent.click(button);
    await advance(1);
    expect(mocks.decline.mock.calls).toEqual([[{ sessionId: "session" }]]);
    expect(button).toBeDisabled();
    await act(async () => {
      finish({ ok: true, data: {} });
    });
    await advance(300);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("keeps the card with a safe retry message on action failure", async () => {
    mocks.decline.mockResolvedValue({ ok: false, code: "INTERNAL_ERROR" });
    render(incoming(), { wrapper: Provider });
    await emit(ring);
    fireEvent.click(screen.getByRole("button", { name: "거절" }));
    await advance(1);
    expect(
      screen.getByText("거절하지 못했어요. 다시 시도해 주세요"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "거절" })).toBeEnabled();
  });
  it("expires after 30 seconds even while focused and does not repeat duplicate events", async () => {
    render(incoming(), { wrapper: Provider });
    await emit(ring);
    screen.getByRole("button", { name: "받기" }).focus();
    await advance(15_000);
    await emit(ring);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    await advance(15_300);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await emit(ring);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it.each([
    [
      "ended",
      {
        ...changed,
        sessionId: null,
        kind: null,
        participantCount: 0,
        participants: [],
      },
    ],
    [
      "accepted elsewhere",
      { ...changed, participants: [{ userId: "me", name: "김하은" }] },
    ],
    [
      "declined",
      { type: "call.declined", roomId: "room", sessionId: "session" },
    ],
  ] satisfies [string, RealtimeEvent][])(
    "dismisses when %s",
    async (_name, event) => {
      render(incoming(), { wrapper: Provider });
      await emit(ring);
      await emit(event);
      await advance(300);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    },
  );
  it.each([
    { myStatus: "dnd" as const },
    { blockedUserIds: ["peer"] },
    { enabled: false },
  ])("suppresses unavailable or unwanted ringing: %j", async (props) => {
    render(incoming(props), { wrapper: Provider });
    await emit(ring);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("removes an existing card after blocking and ignores an earlier call's decline", async () => {
    const view = render(incoming(), { wrapper: Provider });
    await emit(ring);
    await emit({ type: "call.declined", roomId: "room", sessionId: "old" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    view.rerender(incoming({ blockedUserIds: ["peer"] }));
    await advance(300);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("does not reopen an already accepted session on reversed delivery", async () => {
    render(incoming(), { wrapper: Provider });
    await emit({
      ...changed,
      participants: [{ userId: "me", name: "김하은" }],
    });
    await emit(ring);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("does not replay a ring suppressed by do-not-disturb after status changes", async () => {
    const view = render(incoming({ myStatus: "dnd" }), { wrapper: Provider });
    await emit(ring);
    view.rerender(incoming());
    await emit(ring);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  it("never lets an old decline response dismiss a new ringing session", async () => {
    let finish!: (value: unknown) => void;
    mocks.decline.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(incoming(), { wrapper: Provider });
    await emit(ring);
    fireEvent.click(screen.getByRole("button", { name: "거절" }));
    await advance(1);
    await emit({
      ...changed,
      sessionId: null,
      kind: null,
      participantCount: 0,
      participants: [],
    });
    await advance(300);
    await emit({ ...ring, sessionId: "new" });
    await act(async () => {
      finish({ ok: true, data: {} });
    });
    await advance(300);
    expect(
      screen.getByRole("dialog", { name: "이서연 님의 전화" }),
    ).toBeInTheDocument();
  });
});

describe("outgoing DM waiting", () => {
  beforeEach(() => {
    mocks.snapshot.call = {
      roomId: "room",
      roomKind: "dm",
      name: "이서연",
      href: "/dm/room",
      participants: [{ userId: "peer", name: "이서연" }],
      participantId: "p",
      sessionId: "session",
      kind: "huddle",
      joinedAt: 1_800_000_000_000,
      ringing: true,
    };
  });
  it("waits for 30 seconds without ending the call", async () => {
    render(<CallingStatus userId="me" />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "이서연 님을 부르고 있어요",
    );
    await advance(30_000);
    expect(screen.getByRole("status")).toHaveTextContent("받지 않았어요");
    expect(mocks.snapshot.call).not.toBeNull();
  });
  it("shows a decline for the current session only", async () => {
    render(<CallingStatus userId="me" />);
    await emit({ type: "call.declined", roomId: "room", sessionId: "old" });
    expect(screen.queryByText("받지 않았어요")).not.toBeInTheDocument();
    await emit({ type: "call.declined", roomId: "room", sessionId: "session" });
    expect(screen.getByText("받지 않았어요")).toBeInTheDocument();
  });
  it("stops waiting after a peer joins, even if they subsequently leave", async () => {
    render(<CallingStatus userId="me" />);
    await emit(changed);
    await emit({
      ...changed,
      participants: [{ userId: "me", name: "김하은" }],
    });
    await advance(30_000);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
  it("never presents a received or already-open call as an outgoing ring", () => {
    mocks.snapshot.call!.ringing = false;
    render(<CallingStatus userId="me" />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });
});
