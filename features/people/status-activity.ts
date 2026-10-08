import {
  effectiveStatus,
  STATUS_IDLE_MS,
  type StatusPresence,
  type UserStatus,
} from "./status";

// 서버 상태와 자동 자리 비움을 분리하고, 자동 변경의 마지막 값도 반드시 보낸다.
export function createStatusActivity({
  selected,
  publish,
  now = Date.now,
  target = window,
  documentTarget = document,
}: {
  selected: UserStatus;
  publish: (value: StatusPresence) => void;
  now?: () => number;
  target?: Pick<Window, "addEventListener" | "removeEventListener">;
  documentTarget?: Pick<
    Document,
    "addEventListener" | "removeEventListener" | "visibilityState"
  >;
}) {
  let lastActivity = now();
  let hiddenSince = documentTarget.visibilityState === "hidden" ? now() : null;
  let lastSentAt = Number.NEGATIVE_INFINITY;
  let sent: StatusPresence | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const events = [
    "keydown",
    "pointerdown",
    "pointermove",
    "scroll",
    "touchstart",
  ] as const;

  function sync(direct = false) {
    if (closed) return;
    clearTimeout(timer);
    const time = now();
    const next = effectiveStatus(selected, lastActivity, hiddenSince, time);
    const changed =
      !sent || sent.status !== next.status || sent.auto !== next.auto;
    if (changed && (direct || time - lastSentAt >= 60_000)) {
      sent = next;
      lastSentAt = time;
      publish(next);
    }
    const deadlines: number[] = [];
    if (changed && sent !== next && !direct)
      deadlines.push(lastSentAt + 60_000);
    if (selected === "online" && next.status === "online") {
      deadlines.push(lastActivity + STATUS_IDLE_MS);
      if (hiddenSince !== null) deadlines.push(hiddenSince + STATUS_IDLE_MS);
    }
    const nextAt = deadlines
      .filter((deadline) => deadline > time)
      .sort((a, b) => a - b)[0];
    if (nextAt !== undefined) timer = setTimeout(sync, nextAt - time);
  }
  const input = () => {
    lastActivity = now();
    sync();
  };
  const visibility = () => {
    hiddenSince = documentTarget.visibilityState === "hidden" ? now() : null;
    sync();
  };
  for (const event of events)
    target.addEventListener(event, input, { passive: true, capture: true });
  documentTarget.addEventListener("visibilitychange", visibility);
  sync(true);
  return {
    setSelected(value: UserStatus) {
      selected = value;
      sync(true);
    },
    close() {
      closed = true;
      clearTimeout(timer);
      for (const event of events)
        target.removeEventListener(event, input, { capture: true });
      documentTarget.removeEventListener("visibilitychange", visibility);
    },
  };
}
