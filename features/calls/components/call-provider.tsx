"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useRealtimeChannel } from "@/components/realtime-provider";
import { userChannel } from "@/lib/realtime/channels";
import { joinCall } from "@/features/calls/actions";
import type { JoinedCall, MyCall } from "../types";
import type { ActionResult } from "@/lib/actions/result";
import {
  createCallController,
  type CallController,
} from "../client/controller";
import {
  browserAudioMeter,
  browserDevices,
  readCallDevices,
  saveCallDevices,
  type AudioMeter,
  type DeviceAdapter,
} from "../client/devices";
import { loadLiveKit as defaultLoadLiveKit } from "../client/livekit";
import type {
  CallDependencies,
  CallTarget,
  LoadLiveKit,
  MediaTrack,
} from "../client/types";
import { DeviceCheck } from "./device-check";
import { beaconLeave, postCall } from "../client/transport";

const CallContext = createContext<CallController | null>(null);
export function CallProvider({
  children,
  loadLiveKit = defaultLoadLiveKit,
  devices = browserDevices,
  audioMeter = browserAudioMeter,
  transport,
  joinAction = joinCall,
  preferences,
}: {
  children: ReactNode;
  loadLiveKit?: LoadLiveKit;
  devices?: DeviceAdapter;
  audioMeter?: AudioMeter;
  transport?: Pick<CallDependencies, "post" | "beacon">;
  joinAction?: (input: { roomId: string }) => Promise<ActionResult<JoinedCall>>;
  preferences?: {
    read: CallDependencies["readDevices"];
    save: CallDependencies["saveDevices"];
  };
}) {
  const joining = useMutation({
    mutationKey: ["calls", "join"],
    retry: false,
    networkMode: "always",
    mutationFn: (input: { roomId: string }) => joinAction(input),
  });
  const [controller] = useState(() =>
    createCallController({
      loadLiveKit,
      join: (roomId) => joining.mutateAsync({ roomId }),
      post: transport?.post ?? postCall,
      beacon: transport?.beacon ?? beaconLeave,
      readDevices: preferences?.read ?? readCallDevices,
      saveDevices: preferences?.save ?? saveCallDevices,
      enumerateDevices: () => devices.enumerateDevices(),
      now: () => Date.now(),
    }),
  );
  useEffect(() => {
    const pagehide = () => controller.pagehide();
    window.addEventListener("pagehide", pagehide);
    const unsubscribe = devices.subscribe(() => {
      void controller.devicesChanged();
    });
    return () => {
      window.removeEventListener("pagehide", pagehide);
      unsubscribe();
      controller.dispose();
    };
  }, [controller, devices]);
  return (
    <CallContext value={controller}>
      {children}
      <CallOverlays devices={devices} audioMeter={audioMeter} />
    </CallContext>
  );
}
function useController() {
  const controller = useContext(CallContext);
  if (!controller) throw new Error("CallProvider is required");
  return controller;
}
export function useHasCallProvider() {
  return useContext(CallContext) !== null;
}
export function useCall() {
  const controller = useController();
  const snapshot = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  return {
    ...snapshot,
    join: controller.join,
    leave: controller.leave,
    toggleMicrophone: controller.toggleMicrophone,
    toggleCamera: controller.toggleCamera,
    toggleScreenShare: controller.toggleScreenShare,
    openDeviceCheck: controller.openDeviceCheck,
    startAudio: controller.startAudio,
    keepStaying: controller.keepStaying,
    updateTarget: controller.updateTarget,
  };
}
export function CallSession({
  userId,
  callsEnabled,
  myCall,
  targets,
}: {
  userId: string | null;
  callsEnabled: boolean;
  myCall: MyCall | null;
  targets: readonly CallTarget[];
}) {
  const controller = useContext(CallContext);
  useEffect(() => {
    controller?.metadata({ userId, enabled: callsEnabled, myCall, targets });
  }, [controller, userId, callsEnabled, myCall, targets]);
  useRealtimeChannel(userId ? userChannel(userId) : null, (event) => {
    if (event.type === "call.replaced")
      controller?.replaced(event.participantId);
  });
  return null;
}
// 실제 방을 읽은 후에만 라운지의 승인된 명부를 연결에 전달한다.
export function CallTargetSync({ target }: { target: CallTarget }) {
  const controller = useContext(CallContext);
  useEffect(() => {
    controller?.updateTarget(target);
  }, [controller, target]);
  return null;
}
function CallOverlays({
  devices,
  audioMeter,
}: {
  devices: DeviceAdapter;
  audioMeter: AudioMeter;
}) {
  const controller = useController();
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getServerSnapshot,
  );
  const notified = useRef<string | null>(null);
  useEffect(() => {
    if (state.phase !== "disconnected") {
      notified.current = null;
      return;
    }
    if (!state.notice) return;
    const key = `${state.call?.participantId ?? "join"}:${state.notice}`;
    if (notified.current === key) return;
    notified.current = key;
    toast.info(state.notice);
  }, [state.phase, state.notice, state.call?.participantId]);
  return (
    <>
      {state.restore && (
        <div
          className="fixed inset-x-0 top-14 z-[46] flex flex-wrap items-center justify-center gap-2 border-b bg-muted px-4 py-2 md:left-[72px] xl:left-[320px]"
          role="status"
        >
          <span>통화에 다시 들어갈까요?</span>
          <Button
            size="sm"
            onClick={() => {
              void controller.restore();
            }}
          >
            들어가기
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void controller.dismissRestore();
            }}
          >
            나가기
          </Button>
        </div>
      )}
      {state.check && (
        <DeviceCheck
          key={`${state.check.target.roomId}:${state.check.settings}`}
          initial={state.check.devices}
          settings={state.check.settings}
          devices={devices}
          audioMeter={audioMeter}
          onClose={controller.cancelDeviceCheck}
          onConfirm={(value) => {
            void controller.confirmDevices(value);
          }}
        />
      )}
      <Dialog
        open={state.silencePrompt}
        onOpenChange={(open) => {
          if (!open) controller.keepStaying();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>아직 계신가요?</DialogTitle>
            <DialogDescription>
              한동안 대화가 없었어요. 1분 안에 계속 있기를 누르지 않으면
              통화에서 나가요.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                void controller.leave();
              }}
            >
              나가기
            </Button>
            <Button onClick={controller.keepStaying}>계속 있기</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <div hidden aria-hidden="true">
        {state.remoteAudioTracks.map((track) => (
          <RemoteAudio key={track.id} track={track} />
        ))}
      </div>
    </>
  );
}
function RemoteAudio({ track }: { track: MediaTrack }) {
  const [element, setElement] = useState<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (!element) return;
    track.attach(element);
    return () => track.detach(element);
  }, [element, track]);
  return <audio ref={setElement} autoPlay />;
}
export function CallFailureNotice() {
  const call = useCall();
  return (
    <div className="space-y-2 text-sm">
      {call.phase === "reconnecting" && (
        <p role="status">다시 연결하고 있어요</p>
      )}
      {call.reducedQuality && (
        <p role="status">네트워크가 불안정해요. 화질을 낮췄어요</p>
      )}
      {!call.audioAllowed && (
        <Button
          variant="outline"
          onClick={() => {
            void call.startAudio();
          }}
        >
          소리 켜기
        </Button>
      )}
      {call.notice && (
        <div role="status" className="flex flex-wrap items-center gap-2">
          <p>{call.notice}</p>
          {call.phase === "disconnected" && call.call ? (
            <Button
              variant="outline"
              onClick={() => {
                if (call.call) void call.join(call.call);
              }}
            >
              다시 들어가기
            </Button>
          ) : (
            call.call && (
              <Button variant="outline" onClick={call.openDeviceCheck}>
                다른 장치 고르기
              </Button>
            )
          )}
        </div>
      )}
    </div>
  );
}
