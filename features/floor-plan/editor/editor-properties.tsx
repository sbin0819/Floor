"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { polygonArea } from "@/lib/floor-plan/geometry";
import { boundsOf } from "@/lib/floor-plan/render/scene";
import type { FloorPlanDocument, PlanPoint } from "@/lib/floor-plan/types";
import type { PlanIssue } from "@/lib/floor-plan/issues";
import type { PlanEditorSpace } from "../editor-types";
import type { Command } from "./commands";
import type { EditorTool } from "./store";
import { deleteShapesCommand } from "./commands";
import {
  alignShapesCommand,
  setBoundsCommand,
  setRectangleCommand,
  setSpaceLabelCommand,
} from "./transforms";
import { isRectangle, rectanglePoints } from "./canvas-geometry";
import { spaceTypeLabels } from "@/features/bookings/format";
import { amenityLabels, type AmenityKey } from "@/lib/spaces/amenities";
import { SeatProperties } from "./seat-properties";
import { NumberField } from "./editor-number-field";
import { WallProperties } from "./wall-properties";
type Props = {
  branchId: string;
  floorId: string;
  document: FloorPlanDocument;
  spaces: readonly PlanEditorSpace[];
  selectedIds: readonly string[];
  issues: readonly PlanIssue[];
  validationPending: boolean;
  tool: EditorTool;
  snap: boolean;
  disabled?: boolean;
  onCommand: (command: Command | null) => void;
  onSelect: (ids: readonly string[]) => void;
  onConnect: (shapeId: string) => void;
  onCreatePolygon: (polygon: PlanPoint[]) => void;
  onSnap: (enabled: boolean) => void;
  onSeatArray?: () => void;
};
export function EditorProperties(props: Props) {
  const {
    document,
    selectedIds,
    spaces,
    floorId,
    branchId,
    onCommand,
    disabled,
  } = props;
  const [message, setMessage] = useState("");
  const [newBox, setNewBox] = useState({
    x: 0,
    y: 0,
    width: 3000,
    height: 3000,
  });
  const [point, setPoint] = useState({ x: 0, y: 0 });
  const [points, setPoints] = useState<PlanPoint[]>([]);
  const shape =
    selectedIds.length === 1
      ? [...document.spaces, ...document.fixtures].find(
          ({ id }) => id === selectedIds[0],
        )
      : undefined;
  const seat =
    selectedIds.length === 1
      ? document.seats.find(({ id }) => id === selectedIds[0])
      : undefined;
  const wall =
    selectedIds.length === 1
      ? document.walls.find(({ id }) => id === selectedIds[0])
      : undefined;
  const opening =
    selectedIds.length === 1
      ? document.openings.find(({ id }) => id === selectedIds[0])
      : undefined;
  const desk = seat
    ? spaces.find(({ id }) => id.toLowerCase() === seat.spaceId.toLowerCase())
    : undefined;
  const space =
    shape && "spaceId" in shape
      ? spaces.find(
          ({ id }) => id.toLowerCase() === shape.spaceId.toLowerCase(),
        )
      : undefined;
  const bbox = shape ? boundsOf(shape.polygon) : null;
  const box = bbox && {
    x: bbox.minX,
    y: bbox.minY,
    width: bbox.maxX - bbox.minX,
    height: bbox.maxY - bbox.minY,
  };
  const apply = (command: Command | null) => {
    if (disabled) return;
    setMessage(command ? "" : "범위와 입력을 확인해 주세요");
    if (command) onCommand(command);
  };
  const sizeChange = (key: "w" | "h", value: number) => {
    const command = setBoundsCommand(document, {
      ...document.bounds,
      [key]: value,
    });
    if (!command)
      setMessage("도형이 범위 밖으로 나가는 크기로는 바꿀 수 없어요");
    else {
      setMessage("");
      onCommand(command);
    }
  };
  return (
    <div className="divide-y text-sm">
      <section className="space-y-5 p-5">
        <h2 className="text-base font-bold">
          {selectedIds.length > 1
            ? `도형 ${selectedIds.length}개`
            : wall
              ? "벽"
              : opening
                ? "문·뚫린 곳"
                : seat
                  ? "좌석"
                  : shape
                    ? "spaceId" in shape
                      ? "공간 도형"
                      : "고정물"
                    : "층 크기"}
        </h2>
        {(wall || opening) && (
          <WallProperties
            document={document}
            shapeId={selectedIds[0]!}
            disabled={disabled}
            onCommand={apply}
          />
        )}
        {seat && (
          <SeatProperties
            document={document}
            seatId={seat.id}
            displayName={seat.label ?? desk?.name ?? null}
            bookingCount={desk?.futureBookingCount ?? 0}
            disabled={disabled}
            onCommand={onCommand}
          />
        )}
        {!shape && selectedIds.length === 0 && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="층 너비 (mm)"
                value={document.bounds.w}
                onCommit={(value) => sizeChange("w", value)}
                disabled={disabled}
              />
              <NumberField
                label="층 높이 (mm)"
                value={document.bounds.h}
                onCommit={(value) => sizeChange("h", value)}
                disabled={disabled}
              />
            </div>
            <p className="text-muted-foreground">
              공간이나 고정물을 고르면 위치와 크기를 바꿀 수 있어요.
            </p>
          </>
        )}
        {shape && "spaceId" in shape && (
          <>
            <div className="space-y-2">
              <h3 className="font-semibold">연결된 공간</h3>
              <Button
                variant="outline"
                className="w-full justify-between"
                disabled={disabled}
                onClick={() => props.onConnect(shape.id)}
              >
                {space
                  ? `${space.name} · ${spaceTypeLabels[space.type]}`
                  : "연결된 공간 없음"}{" "}
                <span aria-hidden>⌄</span>
              </Button>
              <p className="text-xs text-muted-foreground">
                이 층에서 도형이 없는 공간으로 바꿀 수 있어요.
              </p>
            </div>
          </>
        )}
        {space?.type === "desk_area" && props.onSeatArray && (
          <Button
            variant="outline"
            disabled={disabled}
            onClick={props.onSeatArray}
          >
            좌석 배열
          </Button>
        )}
        {shape && box && isRectangle(shape.polygon) && (
          <div className="grid grid-cols-2 gap-3">
            {(
              [
                ["x", "X"],
                ["y", "Y"],
                ["width", "너비"],
                ["height", "높이"],
              ] as const
            ).map(([key, label]) => (
              <NumberField
                key={key}
                label={`${label} (mm)`}
                value={box[key]}
                disabled={disabled}
                onCommit={(value) =>
                  apply(
                    setRectangleCommand(document, shape.id, {
                      ...box,
                      [key]: value,
                    }),
                  )
                }
              />
            ))}
          </div>
        )}
        {shape && (
          <p className="tabular-nums">
            면적 {(polygonArea(shape.polygon) / 1_000_000).toFixed(1)}m²
          </p>
        )}
        {shape && "spaceId" in shape && (
          <div className="space-y-2">
            <h3 className="font-semibold">라벨 위치</h3>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  apply(setSpaceLabelCommand(document, shape.id, "center"))
                }
              >
                가운데
              </Button>
              <Button
                variant="outline"
                disabled={disabled}
                onClick={() =>
                  apply(setSpaceLabelCommand(document, shape.id, "top-left"))
                }
              >
                왼쪽 위
              </Button>
            </div>
          </div>
        )}
        {selectedIds.length > 1 && (
          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["left", "왼쪽"],
                ["center-x", "가로 가운데"],
                ["right", "오른쪽"],
                ["top", "위"],
                ["center-y", "세로 가운데"],
                ["bottom", "아래"],
              ] as const
            ).map(([value, label]) => (
              <Button
                key={value}
                variant="outline"
                className="px-2 text-xs"
                disabled={disabled}
                onClick={() =>
                  apply(alignShapesCommand(document, selectedIds, value))
                }
              >
                {label}
              </Button>
            ))}
          </div>
        )}
        {selectedIds.length > 0 && (
          <Button
            variant="outline"
            disabled={disabled}
            onClick={() => apply(deleteShapesCommand(document, selectedIds))}
          >
            선택한 도형 지우기
          </Button>
        )}
        {message && (
          <p role="alert" className="text-destructive">
            {message}
          </p>
        )}
      </section>
      {space && (
        <section className="space-y-3 p-5">
          <h2 className="font-bold">공간 정보</h2>
          <p className="text-muted-foreground">
            이름·정원·편의 시설·이용 대상은 공간 관리에서 바꿔요.
          </p>
          <p>
            {space.capacity === null ? "정원 미정" : `${space.capacity}인`} ·{" "}
            {space.amenities
              .map((key) => amenityLabels[key as AmenityKey] ?? key)
              .join(", ") || "편의 시설 없음"}{" "}
            ·{" "}
            {space.access === "teams"
              ? "지정한 팀"
              : space.access === "closed"
                ? "닫힘"
                : space.access === null
                  ? "층 설정 따름"
                  : "모두"}
          </p>
          <Link
            href={`/admin/branches/${branchId}/floors/${floorId}`}
            className="inline-flex min-h-11 items-center rounded-lg border px-3"
          >
            공간 관리에서 열기
          </Link>
        </section>
      )}
      <section className="space-y-3 p-5">
        <h2 className="font-bold">도구</h2>
        <Label className="flex min-h-11 items-center justify-between">
          격자 스냅 100mm
          <Switch
            checked={props.snap}
            onCheckedChange={props.onSnap}
            disabled={disabled}
          />
        </Label>
        {props.tool === "rectangle" && (
          <details>
            <summary className="cursor-pointer py-3">
              숫자로 사각형 만들기
            </summary>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ["x", "시작 X"],
                  ["y", "시작 Y"],
                  ["width", "새 너비"],
                  ["height", "새 높이"],
                ] as const
              ).map(([key, label]) => (
                <NumberField
                  key={key}
                  label={label}
                  value={newBox[key]}
                  onCommit={(value) => setNewBox({ ...newBox, [key]: value })}
                  disabled={disabled}
                />
              ))}
            </div>
            <Button
              className="mt-3"
              disabled={disabled || newBox.width <= 0 || newBox.height <= 0}
              onClick={() =>
                props.onCreatePolygon(
                  rectanglePoints(
                    [newBox.x, newBox.y],
                    [newBox.x + newBox.width, newBox.y + newBox.height],
                  ),
                )
              }
            >
              사각형 도형 만들기
            </Button>
          </details>
        )}
        {props.tool === "polygon" && (
          <details>
            <summary className="cursor-pointer py-3">
              숫자로 다각형 만들기
            </summary>
            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="꼭짓점 X"
                value={point.x}
                onCommit={(x) => setPoint({ ...point, x })}
                disabled={disabled}
              />
              <NumberField
                label="꼭짓점 Y"
                value={point.y}
                onCommit={(y) => setPoint({ ...point, y })}
                disabled={disabled}
              />
            </div>
            <p className="py-2 tabular-nums">꼭짓점 {points.length}개</p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={disabled || points.length >= 64}
                onClick={() => setPoints([...points, [point.x, point.y]])}
              >
                꼭짓점 더하기
              </Button>
              <Button
                variant="outline"
                disabled={disabled || !points.length}
                onClick={() => setPoints(points.slice(0, -1))}
              >
                마지막 점 지우기
              </Button>
              <Button
                disabled={disabled || points.length < 3}
                onClick={() => {
                  props.onCreatePolygon(points);
                  setPoints([]);
                }}
              >
                다각형 도형 만들기
              </Button>
            </div>
          </details>
        )}
      </section>
      <section
        id="editor-issues"
        tabIndex={-1}
        className="space-y-3 p-5 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <h2 className="font-bold text-status-busy-foreground">
          검사 문제 {props.issues.length}
        </h2>
        {props.validationPending ? (
          <p role="status">도형을 검사하고 있어요</p>
        ) : props.issues.length === 0 ? (
          <p className="text-muted-foreground">검사 문제가 없어요</p>
        ) : (
          <ul className="space-y-3">
            {props.issues.map((issue, index) => (
              <li key={`${issue.code}-${issue.shapeId ?? "floor"}-${index}`}>
                <p>{issue.message}</p>
                {issue.shapeId && (
                  <Button
                    variant="link"
                    className="px-0"
                    onClick={() => props.onSelect([issue.shapeId!])}
                  >
                    보기
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
