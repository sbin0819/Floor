"use client";

import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  MonitorUp,
  PhoneOff,
  Settings2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

export type CallControlsProps = {
  microphoneEnabled: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  canShareScreen: boolean;
  disabled?: boolean;
  onMicrophone: () => void;
  onCamera: () => void;
  onScreenShare: () => void;
  onDevices: () => void;
  onLeave: () => void;
};

export function CallControls(props: CallControlsProps) {
  const MicIcon = props.microphoneEnabled ? Mic : MicOff;
  const CameraIcon = props.cameraEnabled ? Camera : CameraOff;
  return (
    <div
      role="group"
      aria-label="통화 조작"
      className="flex flex-wrap items-center justify-center gap-1"
    >
      <Button
        variant="ghost"
        size="icon"
        disabled={props.disabled}
        aria-label={props.microphoneEnabled ? "마이크 끄기" : "마이크 켜기"}
        onClick={props.onMicrophone}
      >
        <MicIcon aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        disabled={props.disabled}
        aria-label={props.cameraEnabled ? "카메라 끄기" : "카메라 켜기"}
        onClick={props.onCamera}
      >
        <CameraIcon aria-hidden="true" />
      </Button>
      {props.canShareScreen && (
        <Button
          variant="ghost"
          size="icon"
          disabled={props.disabled}
          aria-label={
            props.screenShareEnabled ? "화면 공유 끄기" : "화면 공유 켜기"
          }
          onClick={props.onScreenShare}
        >
          <MonitorUp aria-hidden="true" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label="통화 장치 설정"
        onClick={props.onDevices}
      >
        <Settings2 aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="text-destructive hover:text-destructive"
        aria-label="통화 나가기"
        onClick={props.onLeave}
      >
        <PhoneOff aria-hidden="true" />
      </Button>
    </div>
  );
}
