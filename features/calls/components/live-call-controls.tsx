"use client";

import { useSyncExternalStore } from "react";
import { useCall } from "./call-provider";
import { CallControls } from "./call-controls";

const subscribe = () => () => {};
const hasScreenShare = () =>
  typeof navigator.mediaDevices?.getDisplayMedia === "function";
const noScreenShare = () => false;
export function LiveCallControls() {
  const call = useCall();
  const canShareScreen = useSyncExternalStore(
    subscribe,
    hasScreenShare,
    noScreenShare,
  );
  return (
    <CallControls
      {...call}
      canShareScreen={canShareScreen}
      disabled={call.phase !== "connected"}
      onMicrophone={() => {
        void call.toggleMicrophone();
      }}
      onCamera={() => {
        void call.toggleCamera();
      }}
      onScreenShare={() => {
        void call.toggleScreenShare();
      }}
      onDevices={call.openDeviceCheck}
      onLeave={() => {
        void call.leave();
      }}
    />
  );
}
