import { StrictMode, useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CallFailureNotice,
  CallProvider,
  CallSession,
  CallTargetSync,
  useCall,
} from "@/features/calls/components/call-provider";
import {
  saveCallDevices,
  defaultCallDevices,
  type DeviceAdapter,
} from "@/features/calls/client/devices";
import {
  callDependencies,
  callTarget,
  joinedCall,
} from "../helpers/call-client";

const mocks = vi.hoisted(() => ({ join: vi.fn() }));
vi.mock("@/features/calls/actions", () => ({ joinCall: mocks.join }));
vi.mock("@/components/realtime-provider", () => ({
  useRealtimeChannel: () => {},
}));
const noMeter = () => () => {};
function Harness() {
  const call = useCall();
  const [page, setPage] = useState("홈");
  return (
    <>
      <CallSession
        userId="me"
        callsEnabled
        myCall={null}
        targets={[{ ...callTarget }]}
      />
      <CallTargetSync target={{ ...callTarget }} />
      <p>{page}</p>
      <p>{call.phase}</p>
      <p>{call.participants.map((p) => p.name).join(",")}</p>
      <button
        onClick={() => {
          void call.join(callTarget);
        }}
      >
        통화 시작
      </button>
      <button onClick={() => setPage("친구")}>친구 화면</button>
      <CallFailureNotice />
    </>
  );
}
function show() {
  const fake = callDependencies();
  const devices = {
    enumerateDevices: fake.dependencies.enumerateDevices,
    getUserMedia: vi.fn(),
    supportsSpeaker: () => false,
    subscribe: vi.fn(() => vi.fn()),
  } satisfies DeviceAdapter;
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  const view = render(
    <StrictMode>
      <QueryClientProvider client={client}>
        <CallProvider
          loadLiveKit={fake.dependencies.loadLiveKit}
          devices={devices}
          audioMeter={noMeter}
          transport={fake.dependencies}
        >
          <Harness />
        </CallProvider>
      </QueryClientProvider>
    </StrictMode>,
  );
  return { ...fake, ...view, client, devices };
}
beforeEach(() => {
  mocks.join.mockReset();
  mocks.join.mockResolvedValue({ ok: true, data: joinedCall() });
  saveCallDevices(defaultCallDevices());
});
afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});
describe("app-shell call provider", () => {
  it("survives StrictMode setup/cleanup and page rerenders without duplicate connections or metadata feedback", async () => {
    const { room, dependencies, unmount, devices } = show();
    expect(dependencies.loadLiveKit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "통화 시작" }));
    await screen.findByText("connected");
    expect(mocks.join).toHaveBeenCalledExactlyOnceWith({ roomId: "room-a" });
    expect(room.connect).toHaveBeenCalledTimes(1);
    expect(screen.getByText("김하은")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "친구 화면" }));
    expect(screen.getByText("친구")).toBeInTheDocument();
    expect(room.disconnect).not.toHaveBeenCalled();
    await act(async () => room.emit({ type: "media" }));
    expect(room.connect).toHaveBeenCalledTimes(1);
    unmount();
    await waitFor(() =>
      expect(dependencies.post).toHaveBeenCalledWith("leave", "participant-a"),
    );
    expect(room.listeners.size).toBe(0);
    expect(devices.subscribe).toHaveBeenCalledTimes(2);
  });
  it("renders connection failures, retry, autoplay, and reduced-quality messages without exposing errors", async () => {
    const { room, unmount } = show();
    fireEvent.click(screen.getByRole("button", { name: "통화 시작" }));
    await screen.findByText("connected");
    act(() => room.emit({ type: "reconnecting" }));
    expect(screen.getByText("다시 연결하고 있어요")).toBeInTheDocument();
    act(() => room.emit({ type: "autoplay", allowed: false }));
    fireEvent.click(screen.getByRole("button", { name: "소리 켜기" }));
    await waitFor(() => expect(room.startAudio).toHaveBeenCalledTimes(1));
    act(() =>
      room.emit({ type: "device-error", kind: "camera", denied: true }),
    );
    expect(
      screen.getByText("브라우저 설정에서 카메라를 허용해 주세요"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "다른 장치 고르기" }),
    ).toBeInTheDocument();
    act(() => room.emit({ type: "disconnected", reason: "other" }));
    expect(
      screen.getByRole("button", { name: "다시 들어가기" }),
    ).toBeInTheDocument();
    unmount();
  });
  it("pagehide uses the participant-specific beacon and avoids a duplicate unmount leave", async () => {
    const { dependencies, unmount } = show();
    fireEvent.click(screen.getByRole("button", { name: "통화 시작" }));
    await screen.findByText("connected");
    act(() => window.dispatchEvent(new Event("pagehide")));
    expect(dependencies.beacon).toHaveBeenCalledExactlyOnceWith(
      "participant-a",
    );
    unmount();
    expect(dependencies.post).not.toHaveBeenCalled();
  });
  it("the metadata bridge alone is a harmless no-op in isolated non-call screens", () => {
    expect(() =>
      render(
        <CallSession
          userId="me"
          callsEnabled={false}
          myCall={null}
          targets={[]}
        />,
      ),
    ).not.toThrow();
  });
});
