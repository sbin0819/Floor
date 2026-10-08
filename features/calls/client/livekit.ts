import type * as LiveKit from "livekit-client";
import type {
  CallRoom,
  CallRoomEvent,
  LoadLiveKit,
  MediaTrack,
  RoomPerson,
} from "./types";

// SDK 값은 통화를 요청한 뒤에만 불러온다. 테스트는 같은 좁은 어댑터를 주입한다.
export const loadLiveKit: LoadLiveKit = async () => {
  const sdk = await import("livekit-client");
  return { createRoom: (options) => adaptRoom(sdk, new sdk.Room(options)) };
};

export function adaptRoom(sdk: typeof LiveKit, room: LiveKit.Room): CallRoom {
  const listeners = new Set<(event: CallRoomEvent) => void>();
  const tracks = new Map<LiveKit.Track, MediaTrack>();
  const ended = new Map<LiveKit.LocalTrack, () => void>();
  const previousQuality = new Map<
    LiveKit.RemoteTrackPublication,
    LiveKit.VideoQuality | undefined
  >();
  let reduced = false;
  let attached = false;
  const emit = (event: CallRoomEvent) =>
    listeners.forEach((listener) => listener(event));
  const media = () => emit({ type: "media" });
  const onConnected = () => {
    emit({ type: "connected" });
    emit({ type: "autoplay", allowed: room.canPlaybackAudio });
    media();
  };
  const reconnecting = () => emit({ type: "reconnecting" });
  const disconnected = (reason?: LiveKit.DisconnectReason) =>
    emit({
      type: "disconnected",
      reason:
        reason === sdk.DisconnectReason.DUPLICATE_IDENTITY
          ? "replaced"
          : reason === sdk.DisconnectReason.PARTICIPANT_REMOVED ||
              reason === sdk.DisconnectReason.ROOM_DELETED
            ? "removed"
            : "other",
    });
  const quality = (
    value: LiveKit.ConnectionQuality,
    participant: LiveKit.Participant,
  ) => {
    if (participant === room.localParticipant)
      emit({
        type: "quality",
        poor:
          value === sdk.ConnectionQuality.Poor ||
          value === sdk.ConnectionQuality.Lost,
      });
  };
  const speakers = (people: LiveKit.Participant[]) => {
    emit({ type: "speakers", active: people.length > 0 });
    media();
  };
  const autoplay = (allowed: boolean) => emit({ type: "autoplay", allowed });
  const devicesError = (error: Error, kind?: MediaDeviceKind) =>
    emit({
      type: "device-error",
      kind: kind === "videoinput" ? "camera" : "microphone",
      denied: error.name === "NotAllowedError",
    });
  const lower = (publication: LiveKit.RemoteTrackPublication) => {
    if (
      publication.kind !== sdk.Track.Kind.Video ||
      previousQuality.has(publication)
    )
      return;
    previousQuality.set(publication, publication.videoQuality);
    publication.setVideoQuality(sdk.VideoQuality.LOW);
  };
  const subscribed = (
    _track: LiveKit.RemoteTrack,
    publication: LiveKit.RemoteTrackPublication,
  ) => {
    if (reduced) lower(publication);
    media();
  };
  const unsubscribed = (
    track: LiveKit.RemoteTrack,
    publication: LiveKit.RemoteTrackPublication,
  ) => {
    tracks.delete(track);
    previousQuality.delete(publication);
    media();
  };
  const localPublished = (publication: LiveKit.LocalTrackPublication) => {
    const track = publication.track;
    if (track && !ended.has(track)) {
      const listener = () => {
        if (
          publication.source === sdk.Track.Source.Microphone ||
          publication.source === sdk.Track.Source.Camera
        )
          emit({
            type: "device-error",
            kind:
              publication.source === sdk.Track.Source.Camera
                ? "camera"
                : "microphone",
            denied: false,
          });
        media();
      };
      track.on(sdk.TrackEvent.Ended, listener);
      ended.set(track, listener);
    }
    media();
  };
  const localUnpublished = (publication: LiveKit.LocalTrackPublication) => {
    const track = publication.track;
    const listener = track && ended.get(track);
    if (track && listener) {
      track.off(sdk.TrackEvent.Ended, listener);
      ended.delete(track);
    }
    media();
  };
  function bind(on: boolean) {
    if (attached === on) return;
    attached = on;
    const method = on ? "on" : "off";
    room[method](sdk.RoomEvent.Connected, onConnected);
    room[method](sdk.RoomEvent.Reconnected, onConnected);
    room[method](sdk.RoomEvent.Reconnecting, reconnecting);
    room[method](sdk.RoomEvent.SignalReconnecting, reconnecting);
    room[method](sdk.RoomEvent.Disconnected, disconnected);
    room[method](sdk.RoomEvent.ParticipantConnected, media);
    room[method](sdk.RoomEvent.ParticipantDisconnected, media);
    room[method](sdk.RoomEvent.TrackSubscribed, subscribed);
    room[method](sdk.RoomEvent.TrackUnsubscribed, unsubscribed);
    room[method](sdk.RoomEvent.TrackMuted, media);
    room[method](sdk.RoomEvent.TrackUnmuted, media);
    room[method](sdk.RoomEvent.LocalTrackPublished, localPublished);
    room[method](sdk.RoomEvent.LocalTrackUnpublished, localUnpublished);
    room[method](sdk.RoomEvent.ActiveSpeakersChanged, speakers);
    room[method](sdk.RoomEvent.ConnectionQualityChanged, quality);
    room[method](sdk.RoomEvent.MediaDevicesError, devicesError);
    room[method](sdk.RoomEvent.AudioPlaybackStatusChanged, autoplay);
  }
  function trackView(track: LiveKit.Track): MediaTrack | null {
    if (
      track.kind !== sdk.Track.Kind.Audio &&
      track.kind !== sdk.Track.Kind.Video
    )
      return null;
    if (
      track.source !== sdk.Track.Source.Microphone &&
      track.source !== sdk.Track.Source.Camera &&
      track.source !== sdk.Track.Source.ScreenShare &&
      track.source !== sdk.Track.Source.ScreenShareAudio
    )
      return null;
    let view = tracks.get(track);
    if (!view) {
      view = {
        id: track.sid ?? track.mediaStreamTrack.id,
        kind: track.kind,
        source: track.source,
        attach: (element) => {
          track.attach(element);
        },
        detach: (element) => {
          track.detach(element);
        },
      };
      tracks.set(track, view);
    }
    return view;
  }
  return {
    connect: (url, token) => room.connect(url, token),
    async disconnect() {
      bind(false);
      for (const [track, listener] of ended)
        track.off(sdk.TrackEvent.Ended, listener);
      ended.clear();
      listeners.clear();
      tracks.clear();
      previousQuality.clear();
      await room.disconnect(true);
    },
    subscribe(receive) {
      listeners.add(receive);
      bind(true);
      return () => {
        listeners.delete(receive);
        if (!listeners.size) bind(false);
      };
    },
    people(): readonly RoomPerson[] {
      const currentTracks = new Set<LiveKit.Track>();
      const currentPublications = new Set(
        [...room.remoteParticipants.values()].flatMap((person) => [
          ...person.videoTrackPublications.values(),
        ]),
      );
      const people = [
        room.localParticipant,
        ...room.remoteParticipants.values(),
      ].map((person) => ({
        identity: person.identity,
        attributes: person.attributes,
        local: person === room.localParticipant,
        speaking: person.isSpeaking,
        microphoneEnabled: person.isMicrophoneEnabled,
        cameraEnabled: person.isCameraEnabled,
        screenShareEnabled: person.isScreenShareEnabled,
        tracks: [...person.trackPublications.values()].flatMap(
          (publication) => {
            if (publication.track) currentTracks.add(publication.track);
            const track = publication.track && trackView(publication.track);
            return track ? [track] : [];
          },
        ),
      }));
      for (const track of tracks.keys())
        if (!currentTracks.has(track)) tracks.delete(track);
      for (const publication of previousQuality.keys())
        if (!currentPublications.has(publication))
          previousQuality.delete(publication);
      return people;
    },
    async microphone(enabled, deviceId) {
      await room.localParticipant.setMicrophoneEnabled(enabled, { deviceId });
    },
    async camera(enabled, deviceId) {
      await room.localParticipant.setCameraEnabled(enabled, { deviceId });
    },
    async screenShare(enabled) {
      await room.localParticipant.setScreenShareEnabled(enabled);
    },
    async switchDevice(kind, deviceId) {
      await room.switchActiveDevice(kind, deviceId);
    },
    reduceVideoQuality(value) {
      reduced = value;
      if (value)
        for (const participant of room.remoteParticipants.values())
          for (const publication of participant.videoTrackPublications.values())
            lower(publication);
      else {
        for (const [publication, quality] of previousQuality)
          publication.setVideoQuality(quality ?? sdk.VideoQuality.HIGH);
        previousQuality.clear();
      }
    },
    startAudio: () => room.startAudio(),
  };
}
