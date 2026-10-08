import { vi } from "vitest";
import { defaultCallDevices } from "@/features/calls/client/devices";
import type {
  CallDependencies,
  CallRoom,
  CallRoomEvent,
  CallTarget,
  RoomPerson,
} from "@/features/calls/client/types";
import type { JoinedCall } from "@/features/calls/types";

export const callTarget: CallTarget = {
  roomId: "room-a",
  roomKind: "voice",
  name: "회의실",
  href: "/s/space/room-a",
  participants: [
    {
      avatar: { color: "blue" as const, photoUrl: null },
      userId: "me",
      name: "김하은",
    },
    {
      avatar: { color: "blue" as const, photoUrl: null },
      userId: "other",
      name: "박지훈",
    },
  ],
};
export const joinedCall = (participantId = "participant-a"): JoinedCall => ({
  participantId,
  sessionId: "session-a",
  serverUrl: "wss://invalid.test",
  token: "fake-token",
  room: "call:room-a",
  kind: "voice",
});
export class FakeCallRoom implements CallRoom {
  listeners = new Set<(event: CallRoomEvent) => void>();
  peopleValue: RoomPerson[] = [
    {
      identity: "participant-a",
      attributes: {
        participantId: "participant-a",
        userId: "me",
        name: "SDK 이름은 신뢰하지 않음",
      },
      local: true,
      speaking: false,
      microphoneEnabled: false,
      cameraEnabled: false,
      screenShareEnabled: false,
      tracks: [],
    },
  ];
  connect = vi.fn<CallRoom["connect"]>(async () => {});
  disconnect = vi.fn(async () => {});
  people = () => this.peopleValue;
  subscribe = (receive: (event: CallRoomEvent) => void) => {
    this.listeners.add(receive);
    return () => {
      this.listeners.delete(receive);
    };
  };
  emit(event: CallRoomEvent) {
    for (const receive of this.listeners) receive(event);
  }
  microphone = vi.fn<CallRoom["microphone"]>(async (enabled) => {
    this.peopleValue[0]!.microphoneEnabled = enabled;
    this.emit({ type: "media" });
  });
  camera = vi.fn<CallRoom["camera"]>(async (enabled) => {
    this.peopleValue[0]!.cameraEnabled = enabled;
    this.emit({ type: "media" });
  });
  screenShare = vi.fn(async (enabled: boolean) => {
    this.peopleValue[0]!.screenShareEnabled = enabled;
    this.emit({ type: "media" });
  });
  switchDevice = vi.fn<CallRoom["switchDevice"]>(async () => {});
  reduceVideoQuality = vi.fn<CallRoom["reduceVideoQuality"]>(() => {});
  startAudio = vi.fn(async () => {});
}
export function callDependencies(room = new FakeCallRoom()) {
  const createRoom = vi.fn(() => room);
  const dependencies = {
    loadLiveKit: vi.fn(async () => ({ createRoom })),
    join: vi.fn<CallDependencies["join"]>(async () => ({
      ok: true as const,
      data: joinedCall(),
    })),
    post: vi.fn<CallDependencies["post"]>(async () => 204),
    beacon: vi.fn(),
    readDevices: vi.fn<CallDependencies["readDevices"]>(() =>
      defaultCallDevices(),
    ),
    saveDevices: vi.fn(),
    enumerateDevices: vi.fn(async () => [] as MediaDeviceInfo[]),
    now: () => 123_000,
  } satisfies CallDependencies;
  return { dependencies, room, createRoom };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
