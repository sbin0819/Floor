"use client";

import { useCallback, useRef } from "react";

function isVisibleLink(element: HTMLElement) {
  for (
    let node: HTMLElement | null = element;
    node;
    node = node.parentElement
  ) {
    if (
      node.hidden ||
      getComputedStyle(node).display === "none" ||
      getComputedStyle(node).visibility === "hidden"
    )
      return false;
  }
  return true;
}

export function useSpaceTriggerFocus(isCurrentRoute: () => boolean) {
  const trigger = useRef<HTMLElement | null>(null);
  const lastSpace = useRef<string | null>(null);
  const rememberConfirmedSpace = useCallback((spaceId: string) => {
    lastSpace.current = spaceId;
  }, []);
  const rememberSpaceTrigger = useCallback(
    (element: HTMLElement, spaceId: string) => {
      trigger.current = element;
      lastSpace.current = spaceId;
    },
    [],
  );
  const restoreSpaceTrigger = useCallback(() => {
    if (!isCurrentRoute()) return;
    const previous = trigger.current;
    if (previous?.isConnected && isVisibleLink(previous)) {
      previous.focus();
      return;
    }
    if (lastSpace.current === null) return;
    const link = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(
        '[aria-label="공간 목록"] a[href], [data-floor-timetable] a[data-space-id]',
      ),
    ).find(
      (link) =>
        isVisibleLink(link) &&
        new URL(link.href).searchParams.get("space") === lastSpace.current,
    );
    link?.focus();
  }, [isCurrentRoute]);
  return { rememberConfirmedSpace, rememberSpaceTrigger, restoreSpaceTrigger };
}
