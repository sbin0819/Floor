import { useEffect, useRef, useState, type ReactNode } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { CallTiles } from "@/features/calls/components/call-tiles";
import { CallControls } from "@/features/calls/components/call-controls";
import { CallConnectionPanel } from "@/features/calls/components/call-connection-panel";
import {
  CallProvider,
  CallSession,
  CallFailureNotice,
  useCall,
} from "@/features/calls/components/call-provider";
import { DeviceCheck } from "@/features/calls/components/device-check";
import {
  defaultCallDevices,
  type DeviceAdapter,
} from "@/features/calls/client/devices";
import type {
  CallParticipant,
  CallRoom,
  CallRoomEvent,
  CallTarget,
  MediaTrack,
  RoomPerson,
} from "@/features/calls/client/types";

const names = [
  "김하은",
  "박지훈",
  "이서연",
  "최도윤",
  "정유나",
  "강민준",
  "윤서아",
  "한지우",
  "오지안",
  "송예준",
  "임수빈",
  "배서진",
];
const target: CallTarget = {
  roomId: "story-call-room",
  roomKind: "voice",
  name: "디자인 팀 · 회의실",
  href: "/s/story-space/story-call-room",
  participants: names.map((name, index) => ({
    userId: `story-user-${index}`,
    name,
    avatar: { color: "blue" as const, photoUrl: null },
  })),
};
function imageTrack(source: "camera" | "screen_share"): MediaTrack {
  return {
    id: `story-${source}`,
    kind: "video",
    source,
    attach(element) {
      if (element instanceof HTMLVideoElement)
        element.poster = "/seed/photos/meeting-screen-clay.webp";
    },
    detach(element) {
      if (element instanceof HTMLVideoElement)
        element.removeAttribute("poster");
    },
  };
}
function person(
  index: number,
  overrides: Partial<CallParticipant> = {},
): CallParticipant {
  return {
    avatar: { color: "blue" as const, photoUrl: null },
    participantId: `story-participant-${index}`,
    userId: `story-user-${index}`,
    name: names[index] ?? "가상 참가자",
    local: index === 0,
    speaking: index === 1,
    microphoneEnabled: index !== 2,
    cameraEnabled: false,
    screenShareEnabled: false,
    tracks: [],
    ...overrides,
  };
}
const people = names.map((_, index) => person(index));
const sharedPeople = [
  person(0, { screenShareEnabled: true, tracks: [imageTrack("screen_share")] }),
  person(1),
  person(2),
];

function ControlsPreview() {
  const [microphone, setMicrophone] = useState(true);
  const [camera, setCamera] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <div className="space-y-4">
      <CallControls
        microphoneEnabled={microphone}
        cameraEnabled={camera}
        screenShareEnabled={sharing}
        canShareScreen
        onMicrophone={() => setMicrophone((value) => !value)}
        onCamera={() => setCamera((value) => !value)}
        onScreenShare={() => setSharing((value) => !value)}
        onDevices={() =>
          setNotice(
            "이 예시는 화면의 상태만 바꿔요. 실제 장치를 사용하지 않아요.",
          )
        }
        onLeave={() => setNotice("가상 통화에서 나왔어요")}
      />
      {notice && (
        <p role="status" className="text-center text-sm text-muted-foreground">
          {notice}
        </p>
      )}
    </div>
  );
}
const simulatedDevices: DeviceAdapter = {
  async enumerateDevices() {
    return [
      {
        deviceId: "story-mic",
        groupId: "story",
        kind: "audioinput",
        label: "예시 마이크",
        toJSON: () => ({}),
      },
      {
        deviceId: "story-camera",
        groupId: "story",
        kind: "videoinput",
        label: "예시 카메라",
        toJSON: () => ({}),
      },
      {
        deviceId: "story-speaker",
        groupId: "story",
        kind: "audiooutput",
        label: "예시 스피커",
        toJSON: () => ({}),
      },
    ];
  },
  async getUserMedia() {
    return new MediaStream();
  },
  supportsSpeaker: () => true,
  subscribe: () => () => {},
};
const simulatedMeter = (
  _stream: MediaStream,
  onLevel: (level: number) => void,
) => {
  onLevel(36);
  return () => {};
};
function DevicePreview({ denied = false }: { denied?: boolean }) {
  const [open, setOpen] = useState(true);
  const [devices] = useState<DeviceAdapter>(() =>
    denied
      ? {
          ...simulatedDevices,
          getUserMedia: async () => {
            throw new DOMException("", "NotAllowedError");
          },
        }
      : simulatedDevices,
  );
  return (
    <>
      <Button onClick={() => setOpen(true)}>가짜 장치 점검 열기</Button>
      {open && (
        <DeviceCheck
          initial={defaultCallDevices()}
          devices={devices}
          audioMeter={simulatedMeter}
          onClose={() => setOpen(false)}
          onConfirm={() => setOpen(false)}
        />
      )}
    </>
  );
}

class PreviewRoom implements CallRoom {
  private listeners = new Set<(event: CallRoomEvent) => void>();
  private microphoneOn = true;
  private cameraOn = false;
  private sharing = false;
  async connect() {}
  async disconnect() {
    this.listeners.clear();
  }
  subscribe(receive: (event: CallRoomEvent) => void) {
    this.listeners.add(receive);
    return () => {
      this.listeners.delete(receive);
    };
  }
  emit(event: CallRoomEvent) {
    this.listeners.forEach((receive) => receive(event));
  }
  people(): readonly RoomPerson[] {
    return [
      {
        identity: "story-participant-0",
        attributes: {
          participantId: "story-participant-0",
          userId: "story-user-0",
        },
        local: true,
        speaking: false,
        microphoneEnabled: this.microphoneOn,
        cameraEnabled: this.cameraOn,
        screenShareEnabled: this.sharing,
        tracks: [],
      },
      {
        identity: "story-participant-1",
        attributes: {
          participantId: "story-participant-1",
          userId: "story-user-1",
        },
        local: false,
        speaking: true,
        microphoneEnabled: true,
        cameraEnabled: false,
        screenShareEnabled: false,
        tracks: [],
      },
    ];
  }
  async microphone(on: boolean) {
    this.microphoneOn = on;
    this.emit({ type: "media" });
  }
  async camera(on: boolean) {
    this.cameraOn = on;
    this.emit({ type: "media" });
  }
  async screenShare(on: boolean) {
    this.sharing = on;
    this.emit({ type: "media" });
  }
  async switchDevice() {}
  reduceVideoQuality() {}
  async startAudio() {
    this.emit({ type: "autoplay", allowed: true });
  }
}
const noNetwork = { post: async () => 204, beacon: () => {} };
const memoryPreferences = { read: () => defaultCallDevices(), save: () => {} };
const joinPreview = async () => ({
  ok: true as const,
  data: {
    participantId: "story-participant-0",
    sessionId: "story-session",
    serverUrl: "wss://not-used.invalid",
    token: "storybook-only",
    room: "call:story-call-room",
    kind: "voice" as const,
  },
});
type Scenario =
  "panel" | "reconnecting" | "poor" | "autoplay" | "denied" | "disconnected";
function StartPreview({
  room,
  scenario,
}: {
  room: PreviewRoom;
  scenario: Scenario;
}) {
  const call = useCall();
  const join = call.join;
  const applied = useRef(false);
  useEffect(() => {
    void join(target);
  }, [join]);
  useEffect(() => {
    if (call.phase !== "connected" || applied.current) return;
    applied.current = true;
    if (scenario === "reconnecting") room.emit({ type: "reconnecting" });
    if (scenario === "poor") room.emit({ type: "quality", poor: true });
    if (scenario === "autoplay")
      room.emit({ type: "autoplay", allowed: false });
    if (scenario === "denied")
      room.emit({ type: "device-error", kind: "microphone", denied: true });
    if (scenario === "disconnected")
      room.emit({ type: "disconnected", reason: "other" });
  }, [call.phase, room, scenario]);
  return null;
}
function ConnectedPreview({
  scenario = "panel",
  children,
}: {
  scenario?: Scenario;
  children?: ReactNode;
}) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { enabled: false, retry: false },
          mutations: { retry: false },
        },
      }),
  );
  const [room] = useState(() => new PreviewRoom());
  const [sdk] = useState(() => async () => ({ createRoom: () => room }));
  return (
    <QueryClientProvider client={client}>
      <CallProvider
        loadLiveKit={sdk}
        devices={simulatedDevices}
        audioMeter={simulatedMeter}
        transport={noNetwork}
        preferences={memoryPreferences}
        joinAction={joinPreview}
      >
        <CallSession
          userId="story-user-0"
          callsEnabled
          myCall={null}
          targets={[target]}
        />
        <StartPreview room={room} scenario={scenario} />
        <div className="mx-auto w-full max-w-md space-y-4 p-4">
          <p className="text-sm text-muted-foreground">
            모든 연결·장치·서버 응답은 이 예시 안의 가짜 구현이에요.
          </p>
          {scenario === "poor" && (
            <p className="text-sm text-muted-foreground">
              실제 동작과 같이 5초 뒤 낮은 화질 안내가 보여요.
            </p>
          )}
          <CallFailureNotice />
          {children ?? <CallConnectionPanel />}
          {scenario === "reconnecting" && (
            <Button
              variant="outline"
              onClick={() => room.emit({ type: "connected" })}
            >
              다시 연결됨으로 바꾸기
            </Button>
          )}
          {scenario === "poor" && (
            <Button
              variant="outline"
              onClick={() => room.emit({ type: "quality", poor: false })}
            >
              네트워크 회복
            </Button>
          )}
        </div>
      </CallProvider>
    </QueryClientProvider>
  );
}

const meta = {
  title: "통화/화면과 장치",
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    nextjs: { appDirectory: true },
    docs: {
      description: {
        component:
          "가상 참가자와 주입된 연결·장치만 사용해요. 실제 카메라·마이크 권한이나 LiveKit 연결을 요청하지 않아요. 영상 자리는 기존 예시 사진으로 표시해요.",
      },
    },
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const OneParticipant: Story = {
  name: "참가자 한 명",
  render: () => (
    <div className="mx-auto flex h-[560px] max-w-4xl flex-col">
      <CallTiles participants={[person(0)]} />
    </div>
  ),
};
export const NineParticipants: Story = {
  name: "영상 타일 아홉 개",
  render: () => (
    <div className="flex h-[720px] flex-col">
      <CallTiles participants={people.slice(0, 9)} />
    </div>
  ),
};
export const ParticipantOverflow: Story = {
  name: "아홉 개 뒤의 아바타 줄",
  render: () => (
    <div className="flex h-[760px] flex-col">
      <CallTiles participants={people} />
    </div>
  ),
};
export const ScreenSharing: Story = {
  name: "화면 공유",
  render: () => (
    <div className="flex h-[760px] flex-col">
      <CallTiles participants={sharedPeople} />
    </div>
  ),
};
export const Controls: Story = {
  name: "통화 조작",
  render: () => <ControlsPreview />,
};
export const DeviceSettings: Story = {
  name: "장치 점검",
  render: () => <DevicePreview />,
};
export const DevicePermissionDenied: Story = {
  name: "장치 권한 거부와 듣기만 참여",
  render: () => <DevicePreview denied />,
};
export const ConnectionPanel: Story = {
  name: "사이드바 통화 연결 패널",
  render: () => <ConnectedPreview />,
};
export const Reconnecting: Story = {
  name: "다시 연결 중",
  render: () => <ConnectedPreview scenario="reconnecting" />,
};
export const WeakNetwork: Story = {
  name: "5초 뒤 네트워크 약함 안내",
  render: () => <ConnectedPreview scenario="poor" />,
};
export const AutoplayBlocked: Story = {
  name: "소리 재생 허용",
  render: () => <ConnectedPreview scenario="autoplay" />,
};
export const MicrophoneDenied: Story = {
  name: "통화 중 마이크 권한 안내",
  render: () => <ConnectedPreview scenario="denied" />,
};
export const Disconnected: Story = {
  name: "통화 끊김과 다시 들어가기",
  render: () => <ConnectedPreview scenario="disconnected" />,
};
