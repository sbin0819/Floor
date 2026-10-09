"use client";

import { useEffect, useEffectEvent, useId, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { FloorPlanDocument, PlanSeat } from "@/lib/floor-plan/types";
import type { Command } from "./commands";
import {
  applySeatArrayCommand,
  inferSeatArray,
  previewSeatArray,
  type SeatArraySettings,
  type SeatArraySpace,
} from "./seat-array";

type Props = {
  document: FloorPlanDocument;
  areaId: string;
  spaces: readonly SeatArraySpace[];
  disabled?: boolean;
  onCommand: (command: Command) => void;
  onPreview: (seats: readonly PlanSeat[] | null) => void;
  onCancel: () => void;
};
const fields = [
  ["rows", "줄 수", 1, 30],
  ["columns", "칸 수", 1, 30],
  ["width", "좌석 너비 (mm)", 400, 3000],
  ["depth", "좌석 깊이 (mm)", 400, 3000],
  ["gapX", "가로 간격 (mm)", 0, 5000],
  ["gapY", "세로 간격 (mm)", 0, 5000],
] as const;

export function SeatArrayPanel({
  document,
  areaId,
  spaces,
  disabled = false,
  onCommand,
  onPreview,
  onCancel,
}: Props) {
  const id = useId();
  const [settings, setSettings] = useState(
    () => inferSeatArray(document, areaId, spaces)?.settings ?? null,
  );
  const [notice, setNotice] = useState("");
  const preview = useMemo(
    () =>
      settings ? previewSeatArray(document, areaId, spaces, settings) : null,
    [document, areaId, spaces, settings],
  );
  const previewKey = JSON.stringify(disabled ? null : (preview?.seats ?? null));
  const publishPreview = useEffectEvent((clear = false) =>
    onPreview(clear || disabled ? null : (preview?.seats ?? null)),
  );
  useEffect(() => {
    publishPreview();
    return () => publishPreview(true);
  }, [document, previewKey]);
  if (!settings || !preview)
    return <p className="p-5 text-sm">데스크 구역을 먼저 골라 주세요</p>;
  const change = <K extends keyof SeatArraySettings>(
    key: K,
    value: SeatArraySettings[K],
  ) => {
    setNotice("");
    setSettings({ ...settings, [key]: value });
  };
  return (
    <form
      className="space-y-5 p-5 text-sm"
      aria-label="좌석 배열"
      onSubmit={(event) => {
        event.preventDefault();
        if (disabled || !preview.valid) return;
        if (!preview.changed) {
          setNotice("변경된 좌석이 없어요");
          return;
        }
        // 미리보기와 다시 그리기는 UUID를 소비하지 않고 실제 적용에서만 만들어요.
        const ids = new Map(
          preview.newLabels.map((label) => [
            label.trim().toLowerCase(),
            { id: crypto.randomUUID(), spaceId: crypto.randomUUID() },
          ]),
        );
        const command = applySeatArrayCommand(
          document,
          areaId,
          spaces,
          settings,
          ids,
        );
        if (command) {
          onCommand(command);
          setNotice("좌석 배열을 적용했어요");
        } else setNotice("좌석 입력과 범위를 다시 확인해 주세요");
      }}
    >
      <div className="space-y-1">
        <h2 className="text-base font-bold">좌석 배열</h2>
        <p className="text-muted-foreground tabular-nums">
          현재 좌석 {preview.currentCount}개
        </p>
      </div>
      {preview.irregular && (
        <p className="text-muted-foreground">
          현재 좌석이 고른 배열이 아니에요. 값을 바꾸기 전에는 기존 배치를
          그대로 유지해요.
        </p>
      )}
      <fieldset disabled={disabled} className="space-y-5">
        <legend className="sr-only">배열 설정</legend>
        <div className="grid grid-cols-2 gap-3">
          {fields.map(([key, label, min, max]) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`${id}-${key}`}>{label}</Label>
              <Input
                id={`${id}-${key}`}
                type="number"
                min={min}
                max={max}
                step={1}
                value={Number.isFinite(settings[key]) ? settings[key] : ""}
                onChange={(event) =>
                  change(
                    key,
                    event.target.value === ""
                      ? Number.NaN
                      : Number(event.target.value),
                  )
                }
                className="tabular-nums"
              />
            </div>
          ))}
        </div>
        <fieldset>
          <legend className="mb-2 font-medium">좌석 방향</legend>
          <div className="grid grid-cols-4 gap-1">
            {([0, 90, 180, 270] as const).map((rotation) => (
              <Button
                key={rotation}
                type="button"
                variant={settings.rotation === rotation ? "default" : "outline"}
                aria-pressed={settings.rotation === rotation}
                onClick={() => change("rotation", rotation)}
                className="tabular-nums"
              >
                {rotation}°
              </Button>
            ))}
          </div>
        </fieldset>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-prefix`}>이름 앞글자</Label>
            <Input
              id={`${id}-prefix`}
              value={settings.prefix}
              onChange={(event) => change("prefix", event.target.value)}
              aria-describedby={`${id}-names`}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-start`}>시작 번호</Label>
            <Input
              id={`${id}-start`}
              type="number"
              min={1}
              max={999}
              value={Number.isFinite(settings.start) ? settings.start : ""}
              onChange={(event) =>
                change(
                  "start",
                  event.target.value === ""
                    ? Number.NaN
                    : Number(event.target.value),
                )
              }
              className="tabular-nums"
            />
          </div>
        </div>
        <p id={`${id}-names`} className="text-muted-foreground">
          앞글자는 6자까지 쓸 수 있어요. 같은 이름의 좌석은 기존 예약과 연결을
          유지해요.
        </p>
        <p className="text-muted-foreground tabular-nums">
          지금 좌석 {preview.currentCount}개를 바꿔요. 이름이 같은 좌석은 그대로
          이어지고, 새 좌석은 게시할 때 만들어져요.
        </p>
      </fieldset>
      <div aria-live="polite" className="space-y-2">
        <p className="tabular-nums">
          미리보기 {preview.seats.length}개 · 새 좌석 {preview.newLabels.length}
          개
        </p>
        {preview.error && (
          <p className="text-status-busy-strong">{preview.error}</p>
        )}
        {notice && <p>{notice}</p>}
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={disabled || !preview.valid}>
          배열 적용
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={() => {
            onPreview(null);
            onCancel();
          }}
        >
          취소
        </Button>
      </div>
    </form>
  );
}
