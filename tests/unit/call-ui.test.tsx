import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CallControls,
  type CallControlsProps,
} from "@/features/calls/components/call-controls";
import { CallTiles, CallVideo } from "@/features/calls/components/call-tiles";
import { CallConnectionPanel } from "@/features/calls/components/call-connection-panel";
import { LiveCallControls } from "@/features/calls/components/live-call-controls";
import { VoiceChannelList } from "@/features/calls/components/voice-channel-list";
import type { useCall } from "@/features/calls/components/call-provider";
import type {
  CallParticipant,
  MediaTrack,
} from "@/features/calls/client/types";
import type { ChatSpaceNav } from "@/features/chat/types";

const mocks = vi.hoisted(() => ({ call: vi.fn(), push: vi.fn() }));
vi.mock("@/features/calls/components/call-provider", () => ({
  useCall: mocks.call,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push }) }));

type CallState = ReturnType<typeof useCall>;
const epoch = Date.parse("2026-10-09T03:00:00Z");
const mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(
  navigator,
  "mediaDevices",
);
let state: CallState;
function connectedCall(): NonNullable<CallState["call"]> {
  return {
    roomId: "voice-room",
    roomKind: "voice",
    name: "회의실",
    href: "/s/space/voice-room",
    participants: [{ userId: "me", name: "김하은" }],
    participantId: "participant-me",
    sessionId: "session",
    kind: "voice",
    joinedAt: epoch,
  };
}
function person(
  index: number,
  extra: Partial<CallParticipant> = {},
): CallParticipant {
  return {
    participantId: `participant-${index}`,
    userId: `user-${index}`,
    name: `가상 ${index}`,
    local: false,
    speaking: false,
    microphoneEnabled: true,
    cameraEnabled: false,
    screenShareEnabled: false,
    tracks: [],
    ...extra,
  };
}
function track(
  id: string,
  source: MediaTrack["source"] = "camera",
): MediaTrack {
  return { id, kind: "video", source, attach: vi.fn(), detach: vi.fn() };
}
function controls(extra: Partial<CallControlsProps> = {}): CallControlsProps {
  return {
    microphoneEnabled: true,
    cameraEnabled: false,
    screenShareEnabled: false,
    canShareScreen: true,
    onMicrophone: vi.fn(),
    onCamera: vi.fn(),
    onScreenShare: vi.fn(),
    onDevices: vi.fn(),
    onLeave: vi.fn(),
    ...extra,
  };
}
function space(extra: Partial<ChatSpaceNav> = {}): ChatSpaceNav {
  return {
    id: "space",
    kind: "team",
    name: "가상 팀",
    initial: "가",
    iconColor: "blue",
    role: "member",
    unread: false,
    unreadMentions: 0,
    muted: false,
    channels: [],
    voiceChannels: [
      {
        id: "voice-room",
        name: "회의실",
        capacity: 10,
        participantCount: 2,
        participants: [
          { userId: "user-1", name: "김하은" },
          { userId: "user-2", name: "박지훈" },
        ],
      },
    ],
    ...extra,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
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
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {},
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (mediaDevicesDescriptor)
    Object.defineProperty(navigator, "mediaDevices", mediaDevicesDescriptor);
  else Reflect.deleteProperty(navigator, "mediaDevices");
});

describe("call controls", () => {
  it.each([false, true])(
    "uses stateful accessible names, not pressed toggles (%s)",
    (enabled) => {
      render(
        <CallControls
          {...controls({
            microphoneEnabled: enabled,
            cameraEnabled: enabled,
            screenShareEnabled: enabled,
          })}
        />,
      );
      const verb = enabled ? "끄기" : "켜기";
      for (const name of [
        `마이크 ${verb}`,
        `카메라 ${verb}`,
        `화면 공유 ${verb}`,
        "통화 장치 설정",
        "통화 나가기",
      ]) {
        const button = screen.getByRole("button", { name });
        expect(button).not.toHaveAttribute("aria-pressed");
        expect(button).toHaveClass("size-11");
        expect(button).toHaveAttribute("data-slot", "button");
      }
      expect(screen.getByRole("button", { name: "통화 나가기" })).toHaveClass(
        "text-destructive",
      );
    },
  );
  it("hides unsupported screen sharing instead of leaving a disabled control", () => {
    render(<CallControls {...controls({ canShareScreen: false })} />);
    expect(
      screen.queryByRole("button", { name: /화면 공유/ }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(4);
  });
  it("permits every control with keyboard alone in the displayed order", async () => {
    const user = userEvent.setup();
    const props = controls();
    render(<CallControls {...props} />);
    for (const [name, handler] of [
      ["마이크 끄기", props.onMicrophone],
      ["카메라 켜기", props.onCamera],
      ["화면 공유 켜기", props.onScreenShare],
      ["통화 장치 설정", props.onDevices],
      ["통화 나가기", props.onLeave],
    ] as const) {
      await user.tab();
      expect(screen.getByRole("button", { name })).toHaveFocus();
      await user.keyboard("{Enter}");
      expect(handler).toHaveBeenCalledOnce();
    }
  });
  it("disables media changes while preserving device recovery and leave", () => {
    const props = controls({ disabled: true });
    render(<CallControls {...props} />);
    for (const name of ["마이크 끄기", "카메라 켜기", "화면 공유 켜기"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      fireEvent.click(button);
    }
    expect(props.onMicrophone).not.toHaveBeenCalled();
    expect(props.onCamera).not.toHaveBeenCalled();
    expect(props.onScreenShare).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "통화 장치 설정" }));
    fireEvent.click(screen.getByRole("button", { name: "통화 나가기" }));
    expect(props.onDevices).toHaveBeenCalledOnce();
    expect(props.onLeave).toHaveBeenCalledOnce();
  });
  it("wires browser-supported controls to the shared connection only", () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getDisplayMedia: vi.fn() },
    });
    state.phase = "connected";
    render(<LiveCallControls />);
    for (const [name, method] of [
      ["마이크 끄기", state.toggleMicrophone],
      ["카메라 켜기", state.toggleCamera],
      ["화면 공유 켜기", state.toggleScreenShare],
      ["통화 장치 설정", state.openDeviceCheck],
      ["통화 나가기", state.leave],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(method).toHaveBeenCalledOnce();
    }
  });
  it("does not assume screen capture during SSR or unsupported hydration", () => {
    expect(renderToString(<LiveCallControls />)).not.toContain("화면 공유");
    render(<LiveCallControls />);
    expect(
      screen.queryByRole("button", { name: /화면 공유/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "마이크 끄기" })).toBeDisabled();
  });
});

describe("call tiles", () => {
  it("does not describe unknown participants as an empty call", () => {
    const { container } = render(<CallTiles participants={[]} />);
    expect(
      screen.getByText("참가자 정보를 확인하고 있어요"),
    ).toBeInTheDocument();
    expect(container.querySelector("video")).toBeNull();
  });
  it("limits primary tiles to nine and preserves later names and speaking status in avatars", () => {
    const participants = Array.from({ length: 12 }, (_, index) =>
      person(index + 1, { speaking: index === 10 }),
    );
    const { container } = render(<CallTiles participants={participants} />);
    expect(screen.getAllByRole("region")).toHaveLength(9);
    const others = screen.getByRole("list", { name: "다른 참가자" });
    expect(within(others).getAllByRole("listitem")).toHaveLength(3);
    for (const name of ["가상 10", "가상 11", "가상 12"])
      expect(within(others).getByText(name)).toBeInTheDocument();
    expect(
      within(others).getByRole("listitem", { name: "가상 11, 말하는 중" }),
    ).toHaveClass("border-primary");
    expect(
      container.querySelector('[aria-live], [role="status"], [role="alert"]'),
    ).toBeNull();
  });
  it("labels local and speaking tiles with text as well as a colored border", () => {
    render(
      <CallTiles
        participants={[
          person(1, { local: true, speaking: true, microphoneEnabled: false }),
        ]}
      />,
    );
    const tile = screen.getByRole("region", { name: "가상 1, 나, 말하는 중" });
    expect(tile).toHaveClass("border-primary", "snap-center", "basis-full");
    expect(within(tile).getByText("가상 1 (나)")).toBeInTheDocument();
    expect(within(tile).getByLabelText("마이크 꺼짐")).toBeInTheDocument();
  });
  it("uses an avatar when the camera is off and attaches only the enabled video", () => {
    const camera = track("camera");
    const { rerender, container } = render(
      <CallTiles participants={[person(1, { tracks: [camera] })]} />,
    );
    expect(container.querySelector("video")).toBeNull();
    expect(camera.attach).not.toHaveBeenCalled();
    rerender(
      <CallTiles
        participants={[person(1, { tracks: [camera], cameraEnabled: true })]}
      />,
    );
    const video = screen.getByLabelText("가상 1 영상");
    expect(camera.attach).toHaveBeenCalledExactlyOnceWith(video);
    expect(video).toHaveAttribute("autoplay");
    expect(video).toHaveAttribute("playsinline");
    expect((video as HTMLVideoElement).muted).toBe(true);
    rerender(
      <CallTiles
        participants={[person(1, { tracks: [camera], cameraEnabled: false })]}
      />,
    );
    expect(camera.detach).toHaveBeenCalledExactlyOnceWith(video);
  });
  it("detaches an old media track before replacement and cleans up on unmount", () => {
    const first = track("first");
    const second = track("second");
    const { rerender, unmount } = render(
      <CallVideo track={first} label="영상" />,
    );
    const video = screen.getByLabelText("영상");
    expect(first.attach).toHaveBeenCalledExactlyOnceWith(video);
    rerender(<CallVideo track={first} label="새 이름 영상" />);
    expect(first.attach).toHaveBeenCalledOnce();
    rerender(<CallVideo track={second} label="새 이름 영상" />);
    expect(first.detach).toHaveBeenCalledExactlyOnceWith(video);
    expect(second.attach).toHaveBeenCalledExactlyOnceWith(video);
    expect(vi.mocked(first.detach).mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(second.attach).mock.invocationCallOrder[0]!,
    );
    unmount();
    expect(second.detach).toHaveBeenCalledExactlyOnceWith(video);
  });
  it("places a fixed-width vertical participant strip beside desktop screen sharing while preserving mobile swipes and overflow names", () => {
    const shared = track("screen", "screen_share");
    const participants = Array.from({ length: 12 }, (_, index) =>
      person(
        index + 1,
        index === 0 ? { screenShareEnabled: true, tracks: [shared] } : {},
      ),
    );
    render(<CallTiles participants={participants} />);
    const sharing = screen.getByRole("region", {
      name: "가상 1 님의 화면 공유",
    });
    const layout = sharing.parentElement!;
    const tile = screen.getByRole("region", { name: "가상 1" });
    const strip = tile.parentElement!;
    const sidebar = strip.parentElement!;
    expect(layout).toHaveClass("flex-col", "md:flex-row", "md:overflow-hidden");
    expect(sharing).toHaveClass("flex-1", "min-w-0", "md:min-h-0");
    expect(sidebar).toHaveClass(
      "contents",
      "md:flex",
      "md:w-52",
      "xl:w-60",
      "md:shrink-0",
      "md:overflow-y-auto",
    );
    expect(strip).toHaveClass(
      "snap-x",
      "snap-mandatory",
      "overflow-x-auto",
      "md:flex",
      "md:flex-col",
    );
    expect(strip).not.toHaveClass(
      "md:grid",
      "md:grid-cols-3",
      "lg:grid-cols-4",
    );
    expect(tile).toHaveClass("basis-full", "snap-center", "md:basis-auto");
    expect(within(sidebar).getAllByRole("region")).toHaveLength(9);
    expect(
      within(sidebar).getByRole("list", { name: "다른 참가자" }),
    ).toContainElement(screen.getByText("가상 12"));
    expect(layout.children[0]).toBe(sharing);
    expect(layout.children[1]).toBe(sidebar);
  });
  it("gives even an overflow participant's screen share its own large labeled region", () => {
    const shared = track("screen", "screen_share");
    const participants = Array.from({ length: 10 }, (_, index) =>
      person(
        index + 1,
        index === 9 ? { screenShareEnabled: true, tracks: [shared] } : {},
      ),
    );
    render(<CallTiles participants={participants} />);
    const sharing = screen.getByRole("region", {
      name: "가상 10 님의 화면 공유",
    });
    expect(sharing).toHaveClass("flex-1", "min-h-52");
    expect(
      within(sharing).getByLabelText("가상 10 공유 화면"),
    ).toBeInTheDocument();
    expect(shared.attach).toHaveBeenCalledOnce();
    expect(screen.getAllByRole("region")).toHaveLength(10);
    expect(
      within(screen.getByRole("list", { name: "다른 참가자" })).getByText(
        "가상 10",
      ),
    ).toBeInTheDocument();
  });
});

describe("call connection panel", () => {
  it.each(["idle", "checking", "disconnected"] as const)(
    "is absent while %s",
    (phase) => {
      state.phase = phase;
      state.call = connectedCall();
      const { container } = render(<CallConnectionPanel />);
      expect(container).toBeEmptyDOMElement();
    },
  );
  it.each([
    ["connecting", "통화 연결 중"],
    ["connected", "통화 연결됨"],
    ["reconnecting", "다시 연결 중"],
  ] as const)(
    "shows a labeled %s connection with a persistent room link",
    (phase, label) => {
      state.phase = phase;
      state.call = connectedCall();
      vi.useFakeTimers();
      vi.setSystemTime(epoch + 754_000);
      const { container } = render(<CallConnectionPanel />);
      expect(screen.getByText(label)).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "회의실" })).toHaveAttribute(
        "href",
        "/s/space/voice-room",
      );
      expect(screen.getByText("12:34")).toHaveClass("tabular-nums");
      expect(
        container.querySelector('[aria-live], [role="status"], [role="alert"]'),
      ).toBeNull();
    },
  );
  it("waits for an actual call even if the connection phase says connected", () => {
    state.phase = "connected";
    const { container } = render(<CallConnectionPanel />);
    expect(container).toBeEmptyDOMElement();
  });
  it("updates elapsed time in an effect, clamps future times and clears its timer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(epoch - 1000);
    state.phase = "connected";
    state.call = connectedCall();
    const { rerender, unmount } = render(<CallConnectionPanel />);
    expect(screen.getByText("00:00")).toBeInTheDocument();
    act(() => vi.advanceTimersByTime(3000));
    expect(screen.getByText("00:02")).toBeInTheDocument();
    state.call = { ...connectedCall(), joinedAt: epoch + 2000 };
    rerender(<CallConnectionPanel />);
    expect(screen.getByText("00:00")).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("renders a mobile-only fixed panel and keeps server output free from clock reads", () => {
    state.phase = "connected";
    state.call = connectedCall();
    const clock = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("render clock read");
    });
    expect(
      renderToString(<CallConnectionPanel mobile />).replaceAll("<!-- -->", ""),
    ).toContain("00:00");
    expect(clock).not.toHaveBeenCalled();
    clock.mockRestore();
    render(<CallConnectionPanel mobile />);
    expect(screen.getByRole("region", { name: "통화 연결" })).toHaveClass(
      "fixed",
      "inset-x-0",
      "md:hidden",
      "bottom-[calc(4rem+env(safe-area-inset-bottom))]",
      "[body:has([data-chat-screen])_&]:bottom-0",
    );
    expect(
      screen
        .getByRole("region", { name: "통화 연결" })
        .querySelector(".bg-status-free-strong"),
    ).not.toBeNull();
  });
});

describe("voice channel navigation", () => {
  it("renders real room links, 44px rows, current selection and supplied roster names", () => {
    const data = space();
    render(<VoiceChannelList space={data} enabled selected="voice-room" />);
    expect(
      screen.getByRole("heading", { name: "음성 채널" }),
    ).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "회의실, 2명" });
    expect(link).toHaveAttribute("href", "/s/space/voice-room");
    expect(link).toHaveAttribute("aria-current", "page");
    expect(link).toHaveClass("min-h-11", "focus-visible:outline-2");
    expect(screen.getByText("김하은")).toBeInTheDocument();
    expect(screen.getByText("박지훈")).toBeInTheDocument();
  });
  it("keeps lounge participant names out of rendered text even if a caller supplies them", () => {
    render(
      <VoiceChannelList
        space={space({ kind: "branch" })}
        enabled
        selected={null}
      />,
    );
    expect(screen.getByText("2명")).toBeInTheDocument();
    expect(screen.queryByText("김하은")).not.toBeInTheDocument();
    expect(screen.queryByText("박지훈")).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
  it("identifies a full room both visually and in its accessible name", () => {
    const data = space();
    data.voiceChannels[0]!.participantCount = 10;
    render(<VoiceChannelList space={data} enabled selected={null} />);
    expect(
      screen.getByRole("link", { name: "회의실, 10명, 인원 참" }),
    ).toHaveTextContent("10/10");
  });
  it("starts joining on the first ordinary activation and then navigates", async () => {
    const user = userEvent.setup();
    render(<VoiceChannelList space={space()} enabled selected={null} />);
    await user.tab();
    expect(screen.getByRole("link")).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(state.join).toHaveBeenCalledExactlyOnceWith({
      roomId: "voice-room",
      roomKind: "voice",
      name: "회의실",
      href: "/s/space/voice-room",
      participants: space().voiceChannels[0]!.participants,
    });
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/s/space/voice-room");
    expect(vi.mocked(state.join).mock.invocationCallOrder[0]!).toBeLessThan(
      mocks.push.mock.invocationCallOrder[0]!,
    );
  });
  it("navigates an already joined room without opening a second connection", () => {
    state.call = connectedCall();
    state.phase = "connected";
    render(<VoiceChannelList space={space()} enabled selected={null} />);
    fireEvent.click(screen.getByRole("link"));
    expect(state.join).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/s/space/voice-room");
  });
  it("keeps a disabled room navigable but never invokes join", () => {
    render(
      <VoiceChannelList space={space()} enabled={false} selected={null} />,
    );
    const link = screen.getByRole("link", {
      name: "회의실, 2명, 통화를 쓸 수 없어요",
    });
    fireEvent.click(link);
    expect(state.join).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/s/space/voice-room");
  });
  it.each(["metaKey", "ctrlKey", "shiftKey", "altKey"] as const)(
    "preserves %s activation for browser navigation without joining",
    (key) => {
      render(<VoiceChannelList space={space()} enabled selected={null} />);
      const link = screen.getByRole("link");
      const event = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        [key]: true,
      });
      act(() => link.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(false);
      expect(state.join).not.toHaveBeenCalled();
      expect(mocks.push).not.toHaveBeenCalled();
    },
  );
  it("does not turn a middle click into joining or client navigation", () => {
    render(<VoiceChannelList space={space()} enabled selected={null} />);
    fireEvent.click(screen.getByRole("link"), { button: 1 });
    expect(state.join).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it("shows a speaking ring only for the room I currently joined", () => {
    state.call = { ...connectedCall(), roomId: "another-room" };
    state.participants = [person(1, { name: "김하은", speaking: true })];
    const { rerender, container } = render(
      <VoiceChannelList space={space()} enabled selected={null} />,
    );
    expect(container.querySelector(".ring-primary")).toBeNull();
    state.call = connectedCall();
    rerender(<VoiceChannelList space={space()} enabled selected={null} />);
    expect(container.querySelectorAll(".ring-primary")).toHaveLength(1);
  });
});
