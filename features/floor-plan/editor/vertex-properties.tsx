"use client";

import { Button } from "@/components/ui/button";
import type { FloorPlanDocument, PlanPoint } from "@/lib/floor-plan/types";
import type { Command } from "./commands";
import { vertexShape, vertexPoints } from "./canvas-geometry";
import { NumberField } from "./editor-number-field";
import {
  deleteVertexCommand,
  insertVertexCommand,
  setVertexCommand,
} from "./vertex-commands";

export function VertexProperties({
  document,
  shapeId,
  disabled,
  onCommand,
}: {
  document: FloorPlanDocument;
  shapeId: string;
  disabled?: boolean;
  onCommand: (command: Command | null) => void;
}) {
  const shape = vertexShape(document, shapeId);
  if (!shape) return null;
  const points = vertexPoints(document, shapeId);
  const wall = "points" in shape;
  const closed = !wall || shape.closed;
  const minimum = wall ? 2 : 3;
  return (
    <details className="space-y-3">
      <summary className="min-h-11 cursor-pointer py-3 font-semibold focus-visible:outline-2 focus-visible:outline-ring">
        꼭짓점 {points.length}개
      </summary>
      <p className="text-xs text-muted-foreground">
        캔버스에서 두 번 눌러 편집하거나 좌표로 바꿀 수 있어요.
      </p>
      <ol className="space-y-4">
        {points.map((point, index) => {
          const next = points[(index + 1) % points.length]!;
          return (
            <li key={index} className="space-y-2 rounded-lg border p-3">
              <p className="font-medium tabular-nums">점 {index + 1}</p>
              <div className="grid grid-cols-2 gap-2">
                {([0, 1] as const).map((axis) => (
                  <NumberField
                    key={axis}
                    label={`점 ${index + 1} ${axis === 0 ? "X" : "Y"} (mm)`}
                    value={point[axis]}
                    disabled={disabled}
                    min={0}
                    max={axis === 0 ? document.bounds.w : document.bounds.h}
                    onCommit={(value) => {
                      const updated: PlanPoint = [...point];
                      updated[axis] = value;
                      onCommand(
                        setVertexCommand(document, shapeId, index, updated),
                      );
                    }}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  disabled={disabled || points.length <= minimum}
                  onClick={() =>
                    onCommand(deleteVertexCommand(document, shapeId, index))
                  }
                >
                  점 {index + 1} 삭제
                </Button>
                {(closed || index < points.length - 1) && (
                  <Button
                    variant="ghost"
                    disabled={disabled || points.length >= 64}
                    onClick={() =>
                      onCommand(
                        insertVertexCommand(document, shapeId, index, [
                          Math.round((point[0] + next[0]) / 2),
                          Math.round((point[1] + next[1]) / 2),
                        ]),
                      )
                    }
                  >
                    다음 변에 점 추가
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </details>
  );
}
