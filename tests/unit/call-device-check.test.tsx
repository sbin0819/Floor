import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeviceCheck } from "@/features/calls/components/device-check";
import {
  CALL_DEVICES_KEY,
  defaultCallDevices,
  readCallDevices,
  saveCallDevices,
  type DeviceAdapter,
} from "@/features/calls/client/devices";
import { deferred } from "../helpers/call-client";

function media() {
  const track = Object.assign(new EventTarget(), {
    kind: "audio",
    stop: vi.fn(),
  });
  const stream = {
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MediaStream;
  return { track, stream };
}
function setup(speaker = false) {
  const { track, stream } = media();
  const device = {
    kind: "audioinput",
    deviceId: "mic-1",
    label: "내 마이크",
    groupId: "group",
    toJSON: () => ({}),
  } satisfies MediaDeviceInfo;
  const adapter = {
    enumerateDevices: vi.fn(async () => [device]),
    getUserMedia: vi.fn(async () => stream),
    supportsSpeaker: () => speaker,
    subscribe: vi.fn(() => vi.fn()),
  } satisfies DeviceAdapter;
  const stopMeter = vi.fn();
  const meter = vi.fn(() => stopMeter);
  return { adapter, meter, stopMeter, track, stream };
}
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});
describe("device check without real media", () => {
  it("requests permission, then reloads labels, mounts an isolated meter, and stops every track on close", async () => {
    const { adapter, meter, stopMeter, track } = setup();
    const confirm = vi.fn();
    const close = vi.fn();
    const view = render(
      <DeviceCheck
        initial={defaultCallDevices()}
        onConfirm={confirm}
        onClose={close}
        devices={adapter}
        audioMeter={meter}
      />,
    );
    await screen.findByRole("button", { name: "들어가기" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "들어가기" })).toBeEnabled(),
    );
    expect(adapter.enumerateDevices).toHaveBeenCalledTimes(2);
    const order = [
      adapter.enumerateDevices.mock.invocationCallOrder[0]!,
      adapter.getUserMedia.mock.invocationCallOrder[0]!,
      adapter.enumerateDevices.mock.invocationCallOrder[1]!,
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(adapter.getUserMedia.mock.calls[0]).toEqual([
      { audio: { deviceId: undefined }, video: false },
    ]);
    expect(meter).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("combobox", { name: "스피커" }),
    ).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "들어가기" }));
    expect(confirm).toHaveBeenCalledExactlyOnceWith(defaultCallDevices());
    view.unmount();
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(stopMeter).toHaveBeenCalledTimes(1);
  });
  it("shows speaker selection only when supported and uses the remembered option label", async () => {
    const { adapter, meter } = setup(true);
    render(
      <DeviceCheck
        initial={{ ...defaultCallDevices(), microphone: "mic-1" }}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
        devices={adapter}
        audioMeter={meter}
      />,
    );
    expect(
      await screen.findByRole("combobox", { name: "스피커" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "마이크" })).toHaveTextContent(
      "내 마이크",
    );
  });
  it("permission denial gives a safe Korean message and permits listen-only join", async () => {
    const { adapter, meter } = setup();
    adapter.getUserMedia.mockRejectedValueOnce(
      new DOMException("secret device message", "NotAllowedError"),
    );
    const confirm = vi.fn();
    render(
      <DeviceCheck
        initial={defaultCallDevices()}
        onConfirm={confirm}
        onClose={vi.fn()}
        devices={adapter}
        audioMeter={meter}
      />,
    );
    expect(
      await screen.findByText("브라우저 설정에서 마이크를 허용해 주세요"),
    ).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "마이크 끄고 들어가기" }),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "들어가기" })).toBeEnabled(),
    );
    await userEvent.click(screen.getByRole("button", { name: "들어가기" }));
    expect(confirm).toHaveBeenCalledWith({
      ...defaultCallDevices(),
      microphoneEnabled: false,
    });
    expect(adapter.getUserMedia).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("secret device message")).not.toBeInTheDocument();
  });
  it("late permission after unmount stops its stream and does not start a meter", async () => {
    const { adapter, meter, stream, track } = setup();
    const permission = deferred<MediaStream>();
    adapter.getUserMedia.mockReturnValue(permission.promise);
    const view = render(
      <DeviceCheck
        initial={defaultCallDevices()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
        devices={adapter}
        audioMeter={meter}
      />,
    );
    await waitFor(() => expect(adapter.getUserMedia).toHaveBeenCalledTimes(1));
    view.unmount();
    await act(async () => permission.resolve(stream));
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(meter).not.toHaveBeenCalled();
  });
  it("track ended shows a disconnected-device notice, and changing the enabled input releases the old stream", async () => {
    const { adapter, meter, track, stopMeter } = setup();
    render(
      <DeviceCheck
        initial={defaultCallDevices()}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
        devices={adapter}
        audioMeter={meter}
      />,
    );
    await waitFor(() => expect(meter).toHaveBeenCalled());
    act(() => track.dispatchEvent(new Event("ended")));
    expect(screen.getByText("마이크가 연결 해제됐어요")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "마이크 끄고 들어가기" }),
    );
    await waitFor(() => expect(stopMeter).toHaveBeenCalledTimes(1));
    expect(track.stop).toHaveBeenCalledTimes(1);
  });
  it("persists only device preferences; malformed and unavailable storage is harmless", () => {
    saveCallDevices(defaultCallDevices(true));
    expect(readCallDevices()).toEqual(defaultCallDevices(true));
    localStorage.setItem(CALL_DEVICES_KEY, '{"microphone":"x"}');
    expect(readCallDevices()).toBeNull();
    localStorage.setItem(CALL_DEVICES_KEY, "broken");
    expect(readCallDevices()).toBeNull();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readCallDevices()).toBeNull();
    expect(() => saveCallDevices(defaultCallDevices())).not.toThrow();
  });
});
