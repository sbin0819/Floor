import { HTTP_TIMEOUT_MS } from "@/lib/http/config";

export async function postCall(
  path: "leave" | "heartbeat",
  participantId: string,
  signal?: AbortSignal,
): Promise<number> {
  const request = new AbortController();
  const abort = () =>
    request.abort(new DOMException("Request cancelled", "AbortError"));
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(
    () => request.abort(new DOMException("Request timed out", "TimeoutError")),
    HTTP_TIMEOUT_MS,
  );
  try {
    return (
      await fetch(`/api/calls/${path}`, {
        method: "POST",
        credentials: "same-origin",
        keepalive: true,
        signal: request.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ participantId }),
      })
    ).status;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}

export function beaconLeave(participantId: string) {
  try {
    if (
      navigator.sendBeacon?.(
        "/api/calls/leave",
        new Blob([JSON.stringify({ participantId })], {
          type: "application/json",
        }),
      )
    )
      return;
  } catch {}
  // 종료용 요청은 이미 취소한 heartbeat의 signal과 연결하지 않는다.
  void postCall("leave", participantId).catch(() => {});
}
