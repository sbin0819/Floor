"use client";

import { useId } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FloorPlanDocument } from "@/lib/floor-plan/types";
import type { Command } from "./commands";
import { NumberField } from "./editor-number-field";
import { setOpeningCommand, setWallCommand } from "./wall-commands";

export function WallProperties({
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
  const id = useId();
  const wall = document.walls.find((shape) => shape.id === shapeId);
  const opening = document.openings.find((shape) => shape.id === shapeId);
  if (wall)
    return (
      <div className="space-y-4">
        <NumberField
          label="벽 두께 (mm)"
          value={wall.thickness}
          min={50}
          max={500}
          disabled={disabled}
          onCommit={(thickness) =>
            onCommand(setWallCommand(document, shapeId, { thickness }))
          }
        />
        <Label
          className="flex min-h-11 items-center justify-between"
          htmlFor={id}
        >
          닫힌 벽
          <Switch
            id={id}
            disabled={disabled}
            checked={wall.closed}
            onCheckedChange={(closed) =>
              onCommand(setWallCommand(document, shapeId, { closed }))
            }
          />
        </Label>
        <p className="text-xs text-muted-foreground">
          벽을 움직이면 연결된 문도 따라가요. 벽을 지우면 문도 함께 지워져요.
        </p>
      </div>
    );
  if (opening)
    return (
      <div className="space-y-4">
        <NumberField
          label="문 폭 (mm)"
          value={opening.width}
          min={300}
          max={3000}
          disabled={disabled}
          onCommit={(width) =>
            onCommand(setOpeningCommand(document, shapeId, { width }))
          }
        />
        <div className="space-y-1.5">
          <Label htmlFor={id}>문 종류</Label>
          <Select
            value={opening.kind}
            disabled={disabled}
            onValueChange={(kind) => {
              if (kind === "door" || kind === "opening")
                onCommand(setOpeningCommand(document, shapeId, { kind }));
            }}
          >
            <SelectTrigger id={id}>
              <SelectValue>
                {opening.kind === "door" ? "문" : "뚫린 곳"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="door">문</SelectItem>
              <SelectItem value="opening">뚫린 곳</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">
          문은 놓인 변 안에서만 움직여요. 방향키로도 옮길 수 있어요.
        </p>
      </div>
    );
  return null;
}
