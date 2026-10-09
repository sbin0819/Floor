"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

export const WIDE_SCREEN_QUERY = "(min-width: 1024px)";
export type MatchMedia = (
  query: string,
) => Pick<
  MediaQueryList,
  "matches" | "addEventListener" | "removeEventListener"
>;
const browserMatchMedia: MatchMedia = (query) => window.matchMedia(query);
const serverSnapshot = () => true;
const narrowServerSnapshot = () => false;

export function useWideScreen(
  matchMedia: MatchMedia = browserMatchMedia,
  serverWide = true,
) {
  const media = useMemo(
    () =>
      typeof window === "undefined" ||
      (!window.matchMedia && matchMedia === browserMatchMedia)
        ? null
        : matchMedia(WIDE_SCREEN_QUERY),
    [matchMedia],
  );
  const subscribe = useCallback(
    (changed: () => void) => {
      media?.addEventListener("change", changed);
      return () => media?.removeEventListener("change", changed);
    },
    [media],
  );
  const snapshot = useCallback(
    () => media?.matches ?? serverWide,
    [media, serverWide],
  );
  return useSyncExternalStore(
    subscribe,
    snapshot,
    serverWide ? serverSnapshot : narrowServerSnapshot,
  );
}
