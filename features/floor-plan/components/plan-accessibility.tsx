"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  nearestInDirection,
  readingOrder,
  type PlanDirection,
} from "@/lib/floor-plan/render/navigation";
import type {
  PlanScene,
  PlanShape,
  PlanStates,
} from "@/lib/floor-plan/render/types";

const directions: Readonly<Record<string, PlanDirection>> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};

export function PlanAccessibility({
  scene,
  states,
  lastFocusedId,
  selectedSpaceId,
  timeLabel,
  onFocus,
  onSelect,
  onClear,
}: {
  scene: PlanScene;
  states: PlanStates;
  lastFocusedId: string | null;
  selectedSpaceId?: string | null;
  timeLabel: string;
  onFocus: (shape: PlanShape | null) => void;
  onSelect: (shape: PlanShape) => void;
  onClear: () => void;
}) {
  const list = useRef<HTMLUListElement>(null);
  const nodes = useRef(new Map<string, HTMLButtonElement>());
  const ownsFocus = useRef(false);
  const shapes = useMemo(
    () =>
      readingOrder(
        scene.shapes.filter((shape) => {
          if (shape.kind !== "space" || !shape.spaceId) return false;
          const state = states.get(shape.spaceId.toLowerCase());
          return state !== undefined && !state.hidden;
        }),
      ),
    [scene, states],
  );
  const available = shapes.filter(
    (shape) => states.get(shape.spaceId!.toLowerCase())?.kind !== "restricted",
  );
  const tabStop =
    available.find(({ id }) => id === lastFocusedId)?.id ??
    available[0]?.id ??
    null;

  useLayoutEffect(
    () => () => {
      ownsFocus.current = false;
    },
    [],
  );
  useLayoutEffect(() => {
    if (!ownsFocus.current) return;
    const active = document.activeElement;
    if (available.some(({ id }) => nodes.current.get(id) === active)) return;
    const next = tabStop === null ? undefined : nodes.current.get(tabStop);
    if (next) next.focus({ preventScroll: true });
    else {
      ownsFocus.current = false;
      onFocus(null);
    }
  }, [available, tabStop, onFocus]);

  return (
    <ul
      ref={list}
      aria-label="평면도 공간 목록"
      className="sr-only"
      data-plan-accessibility
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return;
        ownsFocus.current = false;
        onFocus(null);
      }}
    >
      {shapes.map((shape) => {
        const state = states.get(shape.spaceId!.toLowerCase())!;
        const disabled = state.kind === "restricted";
        const name = disabled
          ? "전용 공간, 고를 수 없음"
          : [state.name, timeLabel, state.label].filter(Boolean).join(", ");
        return (
          <li key={shape.id}>
            <Button
              ref={(element) => {
                if (element) nodes.current.set(shape.id, element);
                else nodes.current.delete(shape.id);
              }}
              type="button"
              variant="ghost"
              disabled={disabled}
              tabIndex={!disabled && shape.id === tabStop ? 0 : -1}
              aria-pressed={
                !disabled && shape.spaceId === selectedSpaceId?.toLowerCase()
              }
              data-plan-shape-id={shape.id}
              data-space-id={shape.spaceId}
              onFocus={() => {
                ownsFocus.current = true;
                onFocus(shape);
              }}
              onClick={() => onSelect(shape)}
              onKeyDown={(event) => {
                if (
                  event.altKey ||
                  event.ctrlKey ||
                  event.metaKey ||
                  event.nativeEvent.isComposing
                )
                  return;
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  onClear();
                  return;
                }
                const direction = directions[event.key];
                if (!direction) return;
                event.preventDefault();
                event.stopPropagation();
                const next = nearestInDirection(shape, available, direction);
                if (next)
                  nodes.current.get(next.id)?.focus({ preventScroll: true });
              }}
            >
              {name}
            </Button>
          </li>
        );
      })}
    </ul>
  );
}
