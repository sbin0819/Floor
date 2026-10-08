import type { ActionResult } from "@/lib/actions/result";
import type { CallKind, CallPerson, JoinedCall, MyCall } from "../types";

export type CallTarget = {
  roomId: string;
  roomKind: "text" | "voice" | "dm" | "group_dm" | "meeting";
  name: string;
  href: string;
  participants: readonly CallPerson[];
  ringing?: boolean;
};
export type CallDevices = {
  microphone: string;
  camera: string;
  speaker: string;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
};
export type MediaTrack = {
  id: string;
  kind: "audio" | "video";
  source: "microphone" | "camera" | "screen_share" | "screen_share_audio";
  attach(element: HTMLMediaElement): void;
  detach(element: HTMLMediaElement): void;
};
export type RoomPerson = {
  identity: string;
  attributes: Readonly<Record<string, string>>;
  local: boolean;
  speaking: boolean;
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  tracks: readonly MediaTrack[];
};
export type CallParticipant = Omit<RoomPerson, "attributes" | "identity"> & {
  participantId: string;
  userId: string;
  name: string;
};
export type CallRoomEvent =
  | { type: "media" }
  | { type: "reconnecting" | "connected" }
  | { type: "disconnected"; reason: "removed" | "replaced" | "other" }
  | { type: "quality"; poor: boolean }
  | { type: "speakers"; active: boolean }
  | { type: "autoplay"; allowed: boolean }
  | { type: "device-error"; kind: "microphone" | "camera"; denied: boolean };
export interface CallRoom {
  connect(url: string, token: string): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(receive: (event: CallRoomEvent) => void): () => void;
  people(): readonly RoomPerson[];
  microphone(enabled: boolean, deviceId: string): Promise<void>;
  camera(enabled: boolean, deviceId: string): Promise<void>;
  screenShare(enabled: boolean): Promise<void>;
  switchDevice(kind: MediaDeviceKind, deviceId: string): Promise<void>;
  reduceVideoQuality(reduced: boolean): void;
  startAudio(): Promise<void>;
}
export type LoadLiveKit = () => Promise<{
  createRoom(options: { adaptiveStream: false; dynacast: true }): CallRoom;
}>;
export type CallSnapshot = {
  phase:
    | "idle"
    | "checking"
    | "connecting"
    | "connected"
    | "reconnecting"
    | "disconnected";
  call:
    | (CallTarget & {
        participantId: string;
        sessionId: string;
        kind: CallKind;
        joinedAt: number;
      })
    | null;
  participants: readonly CallParticipant[];
  remoteAudioTracks: readonly MediaTrack[];
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  audioAllowed: boolean;
  reducedQuality: boolean;
  silencePrompt: boolean;
  notice: string | null;
  check: { target: CallTarget; devices: CallDevices; settings: boolean } | null;
  restore: MyCall | null;
};
export type CallDependencies = {
  loadLiveKit: LoadLiveKit;
  join: (roomId: string) => Promise<ActionResult<JoinedCall>>;
  post: (path: "leave" | "heartbeat", participantId: string) => Promise<number>;
  beacon: (participantId: string) => void;
  readDevices: () => CallDevices | null;
  saveDevices: (devices: CallDevices) => void;
  enumerateDevices: () => Promise<readonly MediaDeviceInfo[]>;
  now: () => number;
};
