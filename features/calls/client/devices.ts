import type { CallDevices } from "./types";

export const CALL_DEVICES_KEY = "floor:call-devices";
export const defaultCallDevices = (meeting = false): CallDevices => ({
  microphone: "default",
  camera: "default",
  speaker: "default",
  microphoneEnabled: true,
  cameraEnabled: meeting,
});
export function readCallDevices(): CallDevices | null {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem(CALL_DEVICES_KEY) ?? "null",
    );
    if (!value || typeof value !== "object") return null;
    const d = value as Record<string, unknown>;
    if (
      ["microphone", "camera", "speaker"].some(
        (key) => typeof d[key] !== "string",
      ) ||
      typeof d.microphoneEnabled !== "boolean" ||
      typeof d.cameraEnabled !== "boolean"
    )
      return null;
    return {
      microphone: d.microphone as string,
      camera: d.camera as string,
      speaker: d.speaker as string,
      microphoneEnabled: d.microphoneEnabled,
      cameraEnabled: d.cameraEnabled,
    };
  } catch {
    return null;
  }
}
export function saveCallDevices(devices: CallDevices) {
  try {
    localStorage.setItem(CALL_DEVICES_KEY, JSON.stringify(devices));
  } catch {}
}
export function availableCallDevices(
  devices: CallDevices,
  available: readonly MediaDeviceInfo[],
): CallDevices {
  const pick = (kind: MediaDeviceKind, id: string) =>
    id === "default" ||
    available.some((d) => d.kind === kind && d.deviceId === id)
      ? id
      : "default";
  return {
    ...devices,
    microphone: pick("audioinput", devices.microphone),
    camera: pick("videoinput", devices.camera),
    speaker: pick("audiooutput", devices.speaker),
  };
}
export interface DeviceAdapter {
  enumerateDevices(): Promise<readonly MediaDeviceInfo[]>;
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
  supportsSpeaker(): boolean;
  subscribe(listener: () => void): () => void;
}
export const browserDevices: DeviceAdapter = {
  enumerateDevices: () => navigator.mediaDevices.enumerateDevices(),
  getUserMedia: (constraints) =>
    navigator.mediaDevices.getUserMedia(constraints),
  supportsSpeaker: () => "setSinkId" in HTMLMediaElement.prototype,
  subscribe(listener) {
    navigator.mediaDevices?.addEventListener("devicechange", listener);
    return () =>
      navigator.mediaDevices?.removeEventListener("devicechange", listener);
  },
};
export type AudioMeter = (
  stream: MediaStream,
  onLevel: (level: number) => void,
) => () => void;
export const browserAudioMeter: AudioMeter = (stream, onLevel) => {
  if (!stream.getAudioTracks().length || typeof AudioContext === "undefined")
    return () => {};
  const context = new AudioContext();
  void context.resume().catch(() => {});
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  const values = new Uint8Array(analyser.frequencyBinCount);
  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(values);
    const peak = values.reduce((max, n) => Math.max(max, Math.abs(n - 128)), 0);
    onLevel(Math.min(100, peak * 3));
  }, 100);
  return () => {
    clearInterval(timer);
    source.disconnect();
    analyser.disconnect();
    void context.close().catch(() => {});
  };
};
export function deviceErrorMessage(error: unknown, camera = false) {
  return typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "NotAllowedError"
    ? `브라우저 설정에서 ${camera ? "카메라" : "마이크"}를 허용해 주세요`
    : `${camera ? "카메라" : "마이크"}를 사용할 수 없어요. 다른 장치를 골라 주세요`;
}
