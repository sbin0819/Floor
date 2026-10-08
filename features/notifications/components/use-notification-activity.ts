"use client";

import { useEffect, useState } from "react";
import { NOTIFICATION_IDLE_DELAY } from "../polling";

export function useNotificationActivity() {
  const [activity, setActivity] = useState(() => ({
    active:
      typeof document === "undefined" || document.visibilityState !== "hidden",
    resumed: 0,
  }));
  useEffect(() => {
    let active = document.visibilityState !== "hidden";
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pause = () => {
      active = false;
      clearTimeout(timer);
      setActivity((current) =>
        current.active ? { ...current, active: false } : current,
      );
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(pause, NOTIFICATION_IDLE_DELAY);
    };
    const wake = (force: boolean) => {
      if (document.visibilityState === "hidden") return;
      if (!active || force)
        setActivity((current) => ({
          active: true,
          resumed: current.resumed + 1,
        }));
      active = true;
      arm();
    };
    const input = () => wake(false);
    const focus = () => wake(true);
    const visibility = () =>
      document.visibilityState === "hidden" ? pause() : focus();
    if (active) arm();
    document.addEventListener("pointerdown", input, { passive: true });
    document.addEventListener("pointermove", input, { passive: true });
    document.addEventListener("keydown", input);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("focus", focus);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", input);
      document.removeEventListener("pointermove", input);
      document.removeEventListener("keydown", input);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("focus", focus);
    };
  }, []);
  return activity;
}
