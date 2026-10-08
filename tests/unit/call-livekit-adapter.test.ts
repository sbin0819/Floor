import type * as LiveKit from "livekit-client";
import { describe, expect, it, vi } from "vitest";
import { adaptRoom } from "@/features/calls/client/livekit";
import type { CallRoomEvent } from "@/features/calls/client/types";

// SDK 런타임/실제 장치 없이, 설치 타입과 같은 이벤트/트랙 경계만 검사한다.
const sdk = {
  TrackEvent: { Ended: "ended" },
  RoomEvent: {
    Connected: "connected",
    Reconnected: "reconnected",
    Reconnecting: "reconnecting",
    SignalReconnecting: "signalReconnecting",
    Disconnected: "disconnected",
    ParticipantConnected: "participantConnected",
    ParticipantDisconnected: "participantDisconnected",
    TrackSubscribed: "trackSubscribed",
    TrackUnsubscribed: "trackUnsubscribed",
    TrackMuted: "trackMuted",
    TrackUnmuted: "trackUnmuted",
    LocalTrackPublished: "localTrackPublished",
    LocalTrackUnpublished: "localTrackUnpublished",
    ActiveSpeakersChanged: "activeSpeakersChanged",
    ConnectionQualityChanged: "connectionQualityChanged",
    MediaDevicesError: "mediaDevicesError",
    AudioPlaybackStatusChanged: "audioPlaybackChanged",
  },
  Track: {
    Kind: { Audio: "audio", Video: "video" },
    Source: {
      Microphone: "microphone",
      Camera: "camera",
      ScreenShare: "screen_share",
      ScreenShareAudio: "screen_share_audio",
    },
  },
  ConnectionQuality: { Poor: "poor", Lost: "lost" },
  DisconnectReason: {
    DUPLICATE_IDENTITY: 2,
    PARTICIPANT_REMOVED: 4,
    ROOM_DELETED: 5,
  },
  VideoQuality: { LOW: 0, MEDIUM: 1, HIGH: 2 },
} as unknown as typeof LiveKit;
function fixture() {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const participant = () => ({
    identity: "participant-a",
    attributes: { participantId: "participant-a", userId: "me" },
    name: "untrusted",
    isSpeaking: false,
    isMicrophoneEnabled: false,
    isCameraEnabled: false,
    isScreenShareEnabled: false,
    trackPublications: new Map<string, unknown>(),
    videoTrackPublications: new Map<string, unknown>(),
  });
  const local = {
    ...participant(),
    setMicrophoneEnabled: vi.fn(async () => {}),
    setCameraEnabled: vi.fn(async () => {}),
    setScreenShareEnabled: vi.fn(async () => {}),
  };
  const remote = {
    ...participant(),
    identity: "remote-a",
    attributes: { participantId: "remote-a", userId: "other" },
  };
  const room = {
    localParticipant: local,
    remoteParticipants: new Map([[remote.identity, remote]]),
    canPlaybackAudio: false,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    startAudio: vi.fn(async () => {}),
    switchActiveDevice: vi.fn(async () => true),
    on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(listener);
    }),
    off: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
      listeners.get(event)?.delete(listener);
    }),
  };
  const adapter = adaptRoom(sdk, room as unknown as LiveKit.Room);
  const events: CallRoomEvent[] = [];
  const unsubscribe = adapter.subscribe((event) => events.push(event));
  const emit = (event: string, ...args: unknown[]) => {
    for (const listener of listeners.get(event) ?? []) listener(...args);
  };
  return { room, local, remote, adapter, events, listeners, emit, unsubscribe };
}
describe("lazy LiveKit room adapter", () => {
  it("drops unsubscribed tracks and departed publications from the quality restoration cache", async () => {
    const f = fixture();
    const track = {
      sid: "video-a",
      kind: "video",
      source: "camera",
      mediaStreamTrack: { id: "native-video" },
      attach: vi.fn(),
      detach: vi.fn(),
    };
    const publication = {
      kind: "video",
      track,
      videoQuality: 2,
      setVideoQuality: vi.fn(),
    };
    f.remote.trackPublications.set("pub", publication);
    f.remote.videoTrackPublications.set("pub", publication);
    const oldView = f.adapter.people()[1]!.tracks[0];
    f.adapter.reduceVideoQuality(true);
    f.remote.trackPublications.delete("pub");
    f.remote.videoTrackPublications.delete("pub");
    f.emit("trackUnsubscribed", track, publication, f.remote);
    f.adapter.reduceVideoQuality(false);
    expect(publication.setVideoQuality).toHaveBeenCalledExactlyOnceWith(0);
    f.remote.trackPublications.set("pub", publication);
    expect(f.adapter.people()[1]!.tracks[0]).not.toBe(oldView);
    f.remote.videoTrackPublications.set("pub", publication);
    f.adapter.reduceVideoQuality(true);
    f.room.remoteParticipants.clear();
    f.adapter.people();
    f.adapter.reduceVideoQuality(false);
    expect(publication.setVideoQuality).toHaveBeenCalledTimes(2);
    await f.adapter.disconnect();
  });
  it("maps only local quality and restores each publication's preceding quality", async () => {
    const f = fixture();
    const first = { kind: "video", videoQuality: 1, setVideoQuality: vi.fn() };
    const second = { kind: "video", videoQuality: 2, setVideoQuality: vi.fn() };
    f.remote.videoTrackPublications.set("first", first);
    f.emit("connectionQualityChanged", "poor", f.remote);
    expect(f.events).toEqual([]);
    f.emit("connectionQualityChanged", "poor", f.local);
    expect(f.events).toEqual([{ type: "quality", poor: true }]);
    f.adapter.reduceVideoQuality(true);
    expect(first.setVideoQuality).toHaveBeenCalledExactlyOnceWith(0);
    f.emit("trackSubscribed", {}, second, f.remote);
    expect(second.setVideoQuality).toHaveBeenCalledExactlyOnceWith(0);
    f.adapter.reduceVideoQuality(false);
    expect(first.setVideoQuality).toHaveBeenLastCalledWith(1);
    expect(second.setVideoQuality).toHaveBeenLastCalledWith(2);
    await f.adapter.disconnect();
  });
  it("exposes stable narrow tracks, without exposing SDK names, and forwards device methods", async () => {
    const f = fixture();
    const track = {
      sid: "audio-a",
      kind: "audio",
      source: "microphone",
      mediaStreamTrack: { id: "native-a" },
      attach: vi.fn(),
      detach: vi.fn(),
    };
    f.remote.trackPublications.set("pub", { track });
    const first = f.adapter.people()[1]!;
    expect(first).not.toHaveProperty("name");
    expect(first.tracks[0]).toBe(f.adapter.people()[1]!.tracks[0]);
    const element = {} as HTMLAudioElement;
    first.tracks[0]!.attach(element);
    first.tracks[0]!.detach(element);
    expect(track.attach).toHaveBeenCalledWith(element);
    expect(track.detach).toHaveBeenCalledWith(element);
    await f.adapter.microphone(true, "mic-1");
    await f.adapter.camera(false, "camera-1");
    await f.adapter.screenShare(true);
    await f.adapter.switchDevice("audiooutput", "speaker-1");
    expect(f.local.setMicrophoneEnabled).toHaveBeenCalledWith(true, {
      deviceId: "mic-1",
    });
    expect(f.local.setCameraEnabled).toHaveBeenCalledWith(false, {
      deviceId: "camera-1",
    });
    expect(f.local.setScreenShareEnabled).toHaveBeenCalledWith(true);
    expect(f.room.switchActiveDevice).toHaveBeenCalledWith(
      "audiooutput",
      "speaker-1",
    );
    await f.adapter.disconnect();
  });
  it("tracks microphone end but not deliberate unpublish, and removes every SDK/native listener", async () => {
    const f = fixture();
    const track = new EventTarget();
    const remove = vi.spyOn(track, "removeEventListener");
    const publication = {
      source: "microphone",
      track: {
        on: (event: string, listener: () => void) =>
          track.addEventListener(event, listener),
        off: (event: string, listener: () => void) =>
          track.removeEventListener(event, listener),
      },
    };
    f.emit("localTrackPublished", publication);
    track.dispatchEvent(new Event("ended"));
    expect(f.events).toContainEqual({
      type: "device-error",
      kind: "microphone",
      denied: false,
    });
    f.emit("localTrackUnpublished", publication);
    const count = f.events.length;
    track.dispatchEvent(new Event("ended"));
    expect(f.events).toHaveLength(count);
    expect(remove).toHaveBeenCalledWith("ended", expect.any(Function));
    f.emit("localTrackPublished", publication);
    await f.adapter.disconnect();
    expect(remove).toHaveBeenCalledTimes(2);
    expect([...f.listeners.values()].every((list) => list.size === 0)).toBe(
      true,
    );
    expect(f.room.disconnect).toHaveBeenCalledExactlyOnceWith(true);
  });
  it("maps installed disconnect reasons, reconnect, autoplay and active-speaker events", async () => {
    const f = fixture();
    f.emit("disconnected", 2);
    f.emit("disconnected", 4);
    f.emit("disconnected", 5);
    f.emit("disconnected", 1);
    expect(f.events).toEqual([
      { type: "disconnected", reason: "replaced" },
      { type: "disconnected", reason: "removed" },
      { type: "disconnected", reason: "removed" },
      { type: "disconnected", reason: "other" },
    ]);
    f.emit("reconnecting");
    f.emit("reconnected");
    f.emit("audioPlaybackChanged", true);
    f.emit("activeSpeakersChanged", [f.local]);
    expect(f.events).toContainEqual({ type: "reconnecting" });
    expect(f.events).toContainEqual({ type: "connected" });
    expect(f.events).toContainEqual({ type: "autoplay", allowed: false });
    expect(f.events).toContainEqual({ type: "autoplay", allowed: true });
    expect(f.events).toContainEqual({ type: "speakers", active: true });
    f.unsubscribe();
    expect([...f.listeners.values()].every((list) => list.size === 0)).toBe(
      true,
    );
    await f.adapter.disconnect();
  });
});
