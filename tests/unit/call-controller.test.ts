import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCallController } from "@/features/calls/client/controller";
import { defaultCallDevices } from "@/features/calls/client/devices";
import type { ActionResult } from "@/lib/actions/result";
import type { JoinedCall } from "@/features/calls/types";
import {
  callDependencies,
  callTarget,
  deferred,
  FakeCallRoom,
  joinedCall,
} from "../helpers/call-client";

function setup() {
  const fake = callDependencies();
  const controller = createCallController(fake.dependencies);
  controller.metadata({
    userId: "me",
    enabled: true,
    myCall: null,
    targets: [callTarget],
  });
  return { ...fake, controller };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
describe("one client call lifetime", () => {
  it("loads the SDK only after joining, defaults mic on/camera off, and keeps the connection across target metadata updates", async () => {
    const { controller, dependencies, createRoom, room } = setup();
    expect(dependencies.loadLiveKit).not.toHaveBeenCalled();
    await controller.join(callTarget);
    expect(createRoom).toHaveBeenCalledExactlyOnceWith({
      adaptiveStream: false,
      dynacast: true,
    });
    expect(room.connect).toHaveBeenCalledExactlyOnceWith(
      "wss://invalid.test",
      "fake-token",
    );
    expect(room.microphone).toHaveBeenCalledWith(true, "default");
    expect(room.camera).toHaveBeenCalledWith(false, "default");
    expect(controller.getSnapshot()).toMatchObject({
      phase: "connected",
      microphoneEnabled: true,
      cameraEnabled: false,
      call: { joinedAt: 123_000 },
    });
    controller.metadata({
      userId: "me",
      enabled: true,
      myCall: null,
      targets: [{ ...callTarget }],
    });
    await controller.join(callTarget);
    expect(dependencies.join).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
  it("first join checks devices and meeting defaults camera on; cancel does not load LiveKit", async () => {
    const { controller, dependencies, room } = setup();
    dependencies.readDevices.mockReturnValue(null!);
    await controller.join({ ...callTarget, roomKind: "meeting" });
    expect(controller.getSnapshot().check?.devices).toEqual(
      defaultCallDevices(true),
    );
    expect(dependencies.join).not.toHaveBeenCalled();
    controller.cancelDeviceCheck();
    expect(controller.getSnapshot().phase).toBe("idle");
    await controller.join({ ...callTarget, roomKind: "meeting" });
    await controller.confirmDevices(defaultCallDevices(true));
    expect(room.camera).toHaveBeenCalledWith(true, "default");
    expect(dependencies.saveDevices).toHaveBeenCalledWith(
      defaultCallDevices(true),
    );
    controller.dispose();
  });
  it("disconnects before the next action/connection/devices and never connects two rooms", async () => {
    const { controller, dependencies, room, createRoom } = setup();
    await controller.join(callTarget);
    const nextRoom = new FakeCallRoom();
    createRoom.mockReturnValueOnce(nextRoom);
    await controller.join({ ...callTarget, roomId: "room-b" });
    const order = [
      room.disconnect.mock.invocationCallOrder[0]!,
      dependencies.join.mock.invocationCallOrder[1]!,
      nextRoom.connect.mock.invocationCallOrder[0]!,
      nextRoom.microphone.mock.invocationCallOrder[0]!,
    ];
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(room.listeners.size).toBe(0);
    controller.dispose();
  });
  it("a late action result cleans only its participant and cannot replace the new room", async () => {
    const { controller, dependencies } = setup();
    const old = deferred<ActionResult<JoinedCall>>();
    dependencies.join.mockImplementationOnce(
      () => old.promise as Promise<{ ok: true; data: JoinedCall }>,
    );
    const first = controller.join(callTarget);
    await vi.advanceTimersByTimeAsync(0);
    await controller.join({ ...callTarget, roomId: "room-b" });
    old.resolve({ ok: true, data: joinedCall("old-participant") });
    await first;
    expect(dependencies.post).toHaveBeenCalledWith("leave", "old-participant");
    expect(dependencies.post).not.toHaveBeenCalledWith(
      "leave",
      "participant-a",
    );
    expect(controller.getSnapshot().call?.roomId).toBe("room-b");
    controller.dispose();
  });
  it("a stale connect completion and old replacement event cannot close the next participant", async () => {
    const { controller, dependencies, room, createRoom } = setup();
    const connecting = deferred<void>();
    room.connect.mockImplementationOnce(() => connecting.promise);
    const first = controller.join(callTarget);
    await vi.advanceTimersByTimeAsync(0);
    const nextRoom = new FakeCallRoom();
    nextRoom.peopleValue[0]!.identity = "participant-b";
    nextRoom.peopleValue[0]!.attributes = {
      participantId: "participant-b",
      userId: "me",
    };
    createRoom.mockReturnValueOnce(nextRoom);
    dependencies.join.mockResolvedValueOnce({
      ok: true,
      data: joinedCall("participant-b"),
    });
    await controller.join({ ...callTarget, roomId: "room-b" });
    controller.replaced("participant-a");
    connecting.resolve();
    await first;
    expect(nextRoom.disconnect).not.toHaveBeenCalled();
    expect(controller.getSnapshot().call?.participantId).toBe("participant-b");
    expect(dependencies.post).not.toHaveBeenCalledWith(
      "leave",
      "participant-b",
    );
    controller.dispose();
  });
  it.each(["removed", "replaced", "other"] as const)(
    "handles disconnect %s with participant-scoped cleanup",
    async (reason) => {
      const { controller, dependencies, room } = setup();
      await controller.join(callTarget);
      room.emit({ type: "disconnected", reason });
      await vi.advanceTimersByTimeAsync(0);
      expect(
        dependencies.post.mock.calls.filter(([path]) => path === "leave"),
      ).toHaveLength(reason === "other" ? 1 : 0);
      expect(controller.getSnapshot().notice).toBe(
        reason === "removed"
          ? "통화가 끝났어요"
          : reason === "replaced"
            ? "다른 탭에서 통화에 들어갔어요"
            : "통화가 끊겼어요. 다시 들어가 주세요",
      );
      expect(room.listeners.size).toBe(0);
      controller.dispose();
    },
  );
  it("heartbeats even in a hidden document, does not overlap requests, and 404 disconnects without leave", async () => {
    const { controller, dependencies, room } = setup();
    await controller.join(callTarget);
    const heartbeat = deferred<number>();
    dependencies.post.mockImplementationOnce(() => heartbeat.promise);
    await vi.advanceTimersByTimeAsync(90_000);
    expect(dependencies.post).toHaveBeenCalledExactlyOnceWith(
      "heartbeat",
      "participant-a",
    );
    heartbeat.resolve(404);
    await vi.advanceTimersByTimeAsync(0);
    expect(room.disconnect).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(dependencies.post).toHaveBeenCalledTimes(1);
    controller.dispose();
  });
  it("pagehide sends one beacon then releases all timers and listeners", async () => {
    const { controller, dependencies, room } = setup();
    await controller.join(callTarget);
    controller.pagehide();
    controller.dispose();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(dependencies.beacon).toHaveBeenCalledExactlyOnceWith(
      "participant-a",
    );
    expect(dependencies.post).not.toHaveBeenCalled();
    expect(room.listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("pagehide also invalidates a pending token request before there is a Room", async () => {
    const { controller, dependencies } = setup();
    const token = deferred<ActionResult<JoinedCall>>();
    dependencies.join.mockReturnValueOnce(token.promise);
    const join = controller.join(callTarget);
    await vi.advanceTimersByTimeAsync(0);
    controller.pagehide();
    token.resolve({ ok: true, data: joinedCall("late-tab") });
    await join;
    expect(dependencies.loadLiveKit).not.toHaveBeenCalled();
    expect(dependencies.post).toHaveBeenCalledExactlyOnceWith(
      "leave",
      "late-tab",
    );
    expect(controller.getSnapshot().phase).toBe("idle");
  });
  it("settings reuse the same room, while a device permission resolving after leave releases late tracks", async () => {
    const { controller, dependencies, room } = setup();
    await controller.join(callTarget);
    controller.openDeviceCheck();
    await controller.confirmDevices({
      ...defaultCallDevices(),
      microphone: "mic-2",
      speaker: "speaker-2",
    });
    expect(dependencies.join).toHaveBeenCalledTimes(1);
    expect(room.microphone).toHaveBeenLastCalledWith(true, "mic-2");
    expect(room.switchDevice).toHaveBeenCalledWith("audiooutput", "speaker-2");
    const permission = deferred<void>();
    room.camera.mockReturnValueOnce(permission.promise);
    const toggling = controller.toggleCamera();
    await controller.leave();
    permission.resolve();
    await toggling;
    expect(room.disconnect).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().cameraEnabled).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it("uses only approved roster names and matching participant identity attributes", async () => {
    const { controller, room } = setup();
    room.peopleValue.push({
      ...room.peopleValue[0]!,
      local: false,
      identity: "remote-id",
      attributes: { participantId: "wrong-id", userId: "other", name: "spoof" },
    });
    await controller.join(callTarget);
    expect(controller.getSnapshot().participants.map((p) => p.name)).toEqual([
      "김하은",
    ]);
    room.peopleValue[1]!.attributes = {
      participantId: "remote-id",
      userId: "other",
      name: "spoof",
    };
    room.emit({ type: "media" });
    expect(controller.getSnapshot().participants.map((p) => p.name)).toEqual([
      "김하은",
      "박지훈",
    ]);
    controller.updateTarget({ ...callTarget, participants: [] });
    expect(controller.getSnapshot().participants).toEqual([]);
    controller.dispose();
  });
  it("same metadata, roster, and SDK media snapshots are no-ops, preventing render/effect feedback", async () => {
    const { controller, room } = setup();
    await controller.join(callTarget);
    const callback = vi.fn();
    controller.subscribe(callback);
    const before = controller.getSnapshot();
    for (let i = 0; i < 20; i++) {
      controller.updateTarget({
        ...callTarget,
        participants: callTarget.participants.map((person) => ({ ...person })),
      });
      controller.metadata({
        userId: "me",
        enabled: true,
        myCall: null,
        targets: [{ ...callTarget }],
      });
      room.emit({ type: "media" });
    }
    expect(callback).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toBe(before);
    controller.dispose();
  });
  it("an empty navigation roster preserves approved room names; unknown lounge audio still plays without exposing a name", async () => {
    const { controller, room } = setup();
    await controller.join(callTarget);
    controller.metadata({
      userId: "me",
      enabled: true,
      myCall: null,
      targets: [{ ...callTarget, participants: [] }],
    });
    expect(
      controller.getSnapshot().participants.map((person) => person.name),
    ).toEqual(["김하은"]);
    const audio = {
      id: "remote-audio",
      kind: "audio" as const,
      source: "microphone" as const,
      attach: vi.fn(),
      detach: vi.fn(),
    };
    room.peopleValue.push({
      ...room.peopleValue[0]!,
      local: false,
      identity: "unlisted",
      attributes: {
        participantId: "unlisted",
        userId: "not-in-approved-roster",
        name: "비공개 이름",
      },
      tracks: [audio],
    });
    room.emit({ type: "media" });
    expect(
      controller.getSnapshot().participants.map((person) => person.name),
    ).toEqual(["김하은"]);
    expect(controller.getSnapshot().remoteAudioTracks).toEqual([audio]);
    controller.updateTarget({ ...callTarget, participants: [] });
    expect(controller.getSnapshot().participants).toEqual([]);
    controller.dispose();
  });
  it("leaving during SDK load failure still cleans the previously issued participant", async () => {
    const { controller, dependencies } = setup();
    const loading =
      deferred<Awaited<ReturnType<typeof dependencies.loadLiveKit>>>();
    dependencies.loadLiveKit.mockReturnValueOnce(loading.promise);
    const join = controller.join(callTarget);
    await vi.advanceTimersByTimeAsync(0);
    await controller.leave();
    loading.reject(new Error("load failed"));
    await join;
    expect(dependencies.post).toHaveBeenCalledExactlyOnceWith(
      "leave",
      "participant-a",
    );
    expect(controller.getSnapshot().phase).toBe("idle");
    controller.dispose();
  });
  it("lowers remote video after 5 poor seconds and restores it on recovery", async () => {
    const { controller, room } = setup();
    await controller.join(callTarget);
    room.emit({ type: "quality", poor: true });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(room.reduceVideoQuality).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(room.reduceVideoQuality).toHaveBeenCalledWith(true);
    expect(controller.getSnapshot().reducedQuality).toBe(true);
    room.emit({ type: "quality", poor: false });
    expect(room.reduceVideoQuality).toHaveBeenLastCalledWith(false);
    room.emit({ type: "quality", poor: true });
    await vi.advanceTimersByTimeAsync(2_000);
    room.emit({ type: "quality", poor: false });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(room.reduceVideoQuality).toHaveBeenCalledTimes(2);
    controller.dispose();
  });
  it("prompts after 30 silent minutes and leaves one minute later; speech/continue resets it", async () => {
    const { controller, dependencies, room } = setup();
    await controller.join(callTarget);
    room.emit({ type: "speakers", active: true });
    await vi.advanceTimersByTimeAsync(40 * 60_000);
    expect(controller.getSnapshot().silencePrompt).toBe(false);
    room.emit({ type: "speakers", active: false });
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(controller.getSnapshot().silencePrompt).toBe(true);
    controller.keepStaying();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(controller.getSnapshot().phase).toBe("connected");
    await vi.advanceTimersByTimeAsync(30 * 60_000);
    expect(controller.getSnapshot().phase).toBe("idle");
    expect(dependencies.post).toHaveBeenCalledWith("leave", "participant-a");
    expect(vi.getTimerCount()).toBe(0);
  });
  it("reconnect/autoplay/device errors leave the call usable, including permission-denied listen-only", async () => {
    const { controller, room } = setup();
    room.microphone.mockRejectedValueOnce(
      new DOMException("permission", "NotAllowedError"),
    );
    await controller.join(callTarget);
    expect(controller.getSnapshot()).toMatchObject({
      phase: "connected",
      notice: "브라우저 설정에서 마이크를 허용해 주세요",
      microphoneEnabled: false,
    });
    room.emit({ type: "reconnecting" });
    expect(controller.getSnapshot().phase).toBe("reconnecting");
    room.emit({ type: "connected" });
    room.emit({ type: "autoplay", allowed: false });
    await controller.startAudio();
    expect(controller.getSnapshot().audioAllowed).toBe(true);
    room.emit({ type: "device-error", kind: "microphone", denied: false });
    expect(controller.getSnapshot().notice).toBe("마이크가 연결 해제됐어요");
    controller.dispose();
  });
  it("disconnect and late connect errors clean only the issued participant", async () => {
    const { controller, dependencies, room } = setup();
    room.connect.mockRejectedValueOnce(new Error("private SDK error"));
    await controller.join(callTarget);
    expect(dependencies.post).toHaveBeenCalledExactlyOnceWith(
      "leave",
      "participant-a",
    );
    expect(controller.getSnapshot().notice).not.toContain("private");
    controller.dispose();
  });
  it("remembered devices that vanished fall back to default", async () => {
    const { controller, dependencies, room } = setup();
    dependencies.readDevices.mockReturnValue({
      ...defaultCallDevices(),
      microphone: "vanished",
      camera: "vanished",
      speaker: "vanished",
    });
    await controller.join(callTarget);
    expect(room.microphone).toHaveBeenCalledWith(true, "default");
    expect(room.camera).toHaveBeenCalledWith(false, "default");
    expect(room.switchDevice).not.toHaveBeenCalled();
    controller.dispose();
  });
  it("restores or dismisses exactly the old participant and never resurrects a dismissed SSR value", async () => {
    const { controller, dependencies } = setup();
    const myCall = {
      ...joinedCall("previous"),
      roomId: callTarget.roomId,
      joinedAt: "2026-10-08T03:00:00.000Z",
      stale: true,
    };
    const metadata = {
      userId: "me",
      enabled: true,
      myCall,
      targets: [callTarget],
    };
    controller.metadata(metadata);
    expect(controller.getSnapshot().restore?.participantId).toBe("previous");
    await controller.dismissRestore();
    controller.metadata(metadata);
    expect(controller.getSnapshot().restore).toBeNull();
    expect(dependencies.post).toHaveBeenCalledExactlyOnceWith(
      "leave",
      "previous",
    );
    controller.metadata({
      ...metadata,
      myCall: { ...myCall, participantId: "next-old" },
    });
    await controller.restore();
    expect(controller.getSnapshot().phase).toBe("connected");
    controller.dispose();
  });
});
