"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  availableCallDevices,
  browserAudioMeter,
  browserDevices,
  deviceErrorMessage,
  type AudioMeter,
  type DeviceAdapter,
} from "../client/devices";
import type { CallDevices } from "../client/types";

export function DeviceCheck({
  initial,
  settings = false,
  onConfirm,
  onClose,
  devices = browserDevices,
  audioMeter = browserAudioMeter,
}: {
  initial: CallDevices;
  settings?: boolean;
  onConfirm: (devices: CallDevices) => void;
  onClose: () => void;
  devices?: DeviceAdapter;
  audioMeter?: AudioMeter;
}) {
  const [choice, setChoice] = useState(initial);
  const [available, setAvailable] = useState<readonly MediaDeviceInfo[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [speakerSupported, setSpeakerSupported] = useState(false);
  const [level, setLevel] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(
    () => devices.subscribe(() => setRevision((value) => value + 1)),
    [devices],
  );
  useEffect(() => {
    let alive = true;
    let media: MediaStream | null = null;
    let stopMeter: (() => void) | null = null;
    const trackListeners: { track: MediaStreamTrack; listener: () => void }[] =
      [];
    void (async () => {
      try {
        const first = await devices.enumerateDevices();
        if (!alive) return;
        const chosen = availableCallDevices(choice, first);
        if (chosen.microphoneEnabled || chosen.cameraEnabled) {
          media = await devices.getUserMedia({
            audio: chosen.microphoneEnabled
              ? {
                  deviceId:
                    chosen.microphone === "default"
                      ? undefined
                      : { exact: chosen.microphone },
                }
              : false,
            video: chosen.cameraEnabled
              ? {
                  deviceId:
                    chosen.camera === "default"
                      ? undefined
                      : { exact: chosen.camera },
                }
              : false,
          });
          if (!alive) {
            media.getTracks().forEach((track) => track.stop());
            return;
          }
          for (const track of media.getTracks()) {
            const listener = () => {
              if (alive)
                setNotice(
                  `${track.kind === "video" ? "카메라" : "마이크"}가 연결 해제됐어요`,
                );
            };
            track.addEventListener("ended", listener);
            trackListeners.push({ track, listener });
          }
          stopMeter = audioMeter(media, (value) => {
            if (alive) setLevel(value);
          });
        }
        const afterPermission = await devices.enumerateDevices();
        if (!alive) return;
        setAvailable(afterPermission);
        setSpeakerSupported(devices.supportsSpeaker());
        setStream(media);
        setNotice(null);
      } catch (error) {
        if (alive) {
          setNotice(
            deviceErrorMessage(
              error,
              choice.cameraEnabled && !choice.microphoneEnabled,
            ),
          );
          setStream(null);
          setSpeakerSupported(devices.supportsSpeaker());
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
      stopMeter?.();
      for (const { track, listener } of trackListeners)
        track.removeEventListener("ended", listener);
      media?.getTracks().forEach((track) => track.stop());
    };
  }, [choice, devices, audioMeter, revision]);
  useEffect(() => {
    const element = video.current;
    if (element) element.srcObject = stream;
    return () => {
      if (element) element.srcObject = null;
    };
  }, [stream]);
  function change(patch: Partial<CallDevices>) {
    setLoading(true);
    setLevel(0);
    setChoice((old) => ({ ...old, ...patch }));
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="sm:max-w-md"
        onOpenAutoFocus={() => {
          returnFocus.current =
            document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocus.current?.isConnected) return;
          event.preventDefault();
          returnFocus.current.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>장치 점검</DialogTitle>
          <DialogDescription>
            마이크와 카메라를 확인해 주세요. 끄고 들어가서 듣기만 할 수도
            있어요.
          </DialogDescription>
        </DialogHeader>
        <div className="rounded-card relative aspect-video overflow-hidden bg-muted">
          <video
            ref={video}
            autoPlay
            muted
            playsInline
            aria-label="내 카메라 미리보기"
            className="size-full object-cover"
            hidden={!choice.cameraEnabled || !stream}
          />
          {(!choice.cameraEnabled || !stream) && (
            <p className="grid size-full place-items-center text-sm text-muted-foreground">
              카메라가 꺼져 있어요
            </p>
          )}
        </div>
        <DeviceSelect
          label="마이크"
          kind="audioinput"
          value={choice.microphone}
          available={available}
          onChange={(microphone) => change({ microphone })}
        />
        <div
          role="meter"
          aria-label="마이크 소리 크기"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level)}
          className="h-2 overflow-hidden rounded-full bg-muted"
        >
          <div className="h-full bg-primary" style={{ width: `${level}%` }} />
        </div>
        <DeviceSelect
          label="카메라"
          kind="videoinput"
          value={choice.camera}
          available={available}
          onChange={(camera) => change({ camera })}
        />
        {speakerSupported && (
          <DeviceSelect
            label="스피커"
            kind="audiooutput"
            value={choice.speaker}
            available={available}
            onChange={(speaker) => change({ speaker })}
          />
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() =>
              change({ microphoneEnabled: !choice.microphoneEnabled })
            }
          >
            {choice.microphoneEnabled ? "마이크 끄고 들어가기" : "마이크 켜기"}
          </Button>
          <Button
            variant="outline"
            onClick={() => change({ cameraEnabled: !choice.cameraEnabled })}
          >
            {choice.cameraEnabled ? "카메라 끄고 들어가기" : "카메라 켜기"}
          </Button>
        </div>
        {notice && (
          <p role="status" className="text-sm text-destructive">
            {notice}
          </p>
        )}
        {loading && (
          <p role="status" className="text-sm text-muted-foreground">
            장치를 확인하고 있어요
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            취소
          </Button>
          <Button
            disabled={loading}
            onClick={() => onConfirm(availableCallDevices(choice, available))}
          >
            {settings ? "적용" : "들어가기"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
function DeviceSelect({
  label,
  kind,
  value,
  available,
  onChange,
}: {
  label: string;
  kind: MediaDeviceKind;
  value: string;
  available: readonly MediaDeviceInfo[];
  onChange: (value: string) => void;
}) {
  const options = available.filter(
    (device) =>
      device.kind === kind && device.deviceId && device.deviceId !== "default",
  );
  const selected = options.find((device) => device.deviceId === value);
  return (
    <div className="space-y-1">
      <Label htmlFor={`call-${kind}`}>{label}</Label>
      <Select value={selected ? value : "default"} onValueChange={onChange}>
        <SelectTrigger id={`call-${kind}`} className="w-full">
          <SelectValue>{selected?.label || "기본 장치"}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">기본 장치</SelectItem>
          {options.map((device, index) => (
            <SelectItem key={device.deviceId} value={device.deviceId}>
              {device.label || `${label} ${index + 1}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
