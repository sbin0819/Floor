import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beaconLeave, postCall } from "@/features/calls/client/transport";
import { createCallController } from "@/features/calls/client/controller";
import { HTTP_TIMEOUT_MS } from "@/lib/http/config";
import { callDependencies, callTarget } from "../helpers/call-client";

function pendingFetch() {
  const signals: AbortSignal[] = [];
  const fetcher = vi.fn((_path: RequestInfo | URL, init?: RequestInit) => {
    const signal = init!.signal!;
    signals.push(signal);
    return new Promise<Response>((_resolve, reject) => {
      if (signal.aborted) reject(signal.reason);
      else
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
    });
  });
  vi.stubGlobal("fetch", fetcher);
  return { signals, fetcher };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("native call request lifetime", () => {
  it.each(["leave", "heartbeat"] as const)(
    "bounds %s to 15 seconds and preserves keepalive and cookie settings",
    async (path) => {
      const { signals, fetcher } = pendingFetch();
      const pending = postCall(path, "participant-a");
      const failure = expect(pending).rejects.toMatchObject({
        name: "TimeoutError",
      });
      await vi.advanceTimersByTimeAsync(HTTP_TIMEOUT_MS - 1);
      expect(signals[0]!.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await failure;
      expect(fetcher).toHaveBeenCalledExactlyOnceWith(
        `/api/calls/${path}`,
        expect.objectContaining({
          method: "POST",
          credentials: "same-origin",
          keepalive: true,
          body: JSON.stringify({ participantId: "participant-a" }),
        }),
      );
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("returns HTTP 404 for controller handling and releases its deadline and external listener", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    expect(
      await postCall("heartbeat", "participant-a", controller.signal),
    ).toBe(404);
    expect(remove).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([false, true])(
    "keeps intentional cancellation distinct from timeout (already aborted=%s)",
    async (alreadyAborted) => {
      const { signals } = pendingFetch();
      const owner = new AbortController();
      if (alreadyAborted) owner.abort();
      const result = postCall("heartbeat", "participant-a", owner.signal);
      const failure = expect(result).rejects.toMatchObject({
        name: "AbortError",
      });
      owner.abort();
      await failure;
      expect(signals[0]!.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("releases the heartbeat lock after timeout so the next interval can run", async () => {
    const { fetcher } = pendingFetch();
    const { dependencies } = callDependencies();
    const controller = createCallController({
      ...dependencies,
      post: postCall,
    });
    controller.metadata({
      userId: "me",
      enabled: true,
      myCall: null,
      targets: [callTarget],
    });
    await controller.join(callTarget);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(HTTP_TIMEOUT_MS);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetcher).toHaveBeenCalledTimes(2);
    controller.pagehide();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["leave", "dispose", "pagehide", "replace"] as const)(
    "%s aborts a heartbeat without aborting the independent exit request",
    async (operation) => {
      const { signals, fetcher } = pendingFetch();
      const { dependencies } = callDependencies();
      const beacon = vi.fn();
      const controller = createCallController({
        ...dependencies,
        post: postCall,
        beacon,
      });
      controller.metadata({
        userId: "me",
        enabled: true,
        myCall: null,
        targets: [callTarget],
      });
      await controller.join(callTarget);
      await vi.advanceTimersByTimeAsync(30_000);
      let exit: Promise<void> | undefined;
      if (operation === "leave") exit = controller.leave();
      else if (operation === "dispose") controller.dispose();
      else if (operation === "pagehide") controller.pagehide();
      else controller.replaced("participant-a");
      await vi.advanceTimersByTimeAsync(0);
      expect(signals[0]!.aborted).toBe(true);
      if (operation === "leave" || operation === "dispose") {
        expect(fetcher).toHaveBeenLastCalledWith(
          "/api/calls/leave",
          expect.anything(),
        );
        expect(signals[1]!.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(HTTP_TIMEOUT_MS);
        await exit;
      } else {
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(beacon).toHaveBeenCalledTimes(operation === "pagehide" ? 1 : 0);
      }
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("uses beacon on pagehide and a separate keepalive fallback if it is unavailable", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    const sendBeacon = vi.fn(() => true);
    vi.stubGlobal("navigator", { sendBeacon });
    beaconLeave("participant-a");
    expect(sendBeacon).toHaveBeenCalledWith(
      "/api/calls/leave",
      expect.any(Blob),
    );
    expect(fetcher).not.toHaveBeenCalled();
    sendBeacon.mockReturnValue(false);
    beaconLeave("participant-b");
    await vi.advanceTimersByTimeAsync(0);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "/api/calls/leave",
      expect.objectContaining({ keepalive: true }),
    );
    expect(vi.getTimerCount()).toBe(0);
  });
});
