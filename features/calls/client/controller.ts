import {
  availableCallDevices,
  defaultCallDevices,
  deviceErrorMessage,
} from "./devices";
import type {
  CallDependencies,
  CallDevices,
  CallParticipant,
  CallRoom,
  CallRoomEvent,
  CallSnapshot,
  CallTarget,
} from "./types";
import type { MyCall } from "../types";

export const initialCallSnapshot: CallSnapshot = {
  phase: "idle",
  call: null,
  participants: [],
  remoteAudioTracks: [],
  microphoneEnabled: false,
  cameraEnabled: false,
  screenShareEnabled: false,
  audioAllowed: true,
  reducedQuality: false,
  silencePrompt: false,
  notice: null,
  check: null,
  restore: null,
};
type Connection = {
  generation: number;
  participantId: string;
  room: CallRoom;
  unsubscribe: () => void;
  heartbeat: ReturnType<typeof setInterval> | null;
  beating: boolean;
};

export function createCallController(deps: CallDependencies) {
  let state = initialCallSnapshot;
  const listeners = new Set<() => void>();
  let generation = 0;
  let joinRequest = 0;
  let active: Connection | null = null;
  let userId: string | null = null;
  let enabled = false;
  let targets: readonly CallTarget[] = [];
  let prefs = defaultCallDevices();
  let poorTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let exitTimer: ReturnType<typeof setTimeout> | null = null;
  let speaking = false;
  let dismissedRestore: string | null = null;
  const update = (patch: Partial<CallSnapshot>) => {
    const unchanged = (Object.keys(patch) as (keyof CallSnapshot)[]).every(
      (key) => {
        if (Object.is(state[key], patch[key])) return true;
        if (key === "remoteAudioTracks")
          return (
            state.remoteAudioTracks.length ===
              patch.remoteAudioTracks!.length &&
            state.remoteAudioTracks.every(
              (track, index) => track === patch.remoteAudioTracks![index],
            )
          );
        if (key === "participants") {
          const next = patch.participants!;
          return (
            state.participants.length === next.length &&
            state.participants.every((person, index) => {
              const other = next[index]!;
              return (
                person.participantId === other.participantId &&
                person.userId === other.userId &&
                person.name === other.name &&
                person.avatar.color === other.avatar.color &&
                person.avatar.photoUrl === other.avatar.photoUrl &&
                person.local === other.local &&
                person.speaking === other.speaking &&
                person.microphoneEnabled === other.microphoneEnabled &&
                person.cameraEnabled === other.cameraEnabled &&
                person.screenShareEnabled === other.screenShareEnabled &&
                person.tracks.length === other.tracks.length &&
                person.tracks.every((track, i) => track === other.tracks[i])
              );
            })
          );
        }
        return (
          (key === "call" || key === "check" || key === "restore") &&
          JSON.stringify(state[key]) === JSON.stringify(patch[key])
        );
      },
    );
    if (unchanged) return;
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  };
  const current = (connection: Connection) =>
    active === connection && generation === connection.generation;
  const postLeave = async (participantId: string) => {
    try {
      await deps.post("leave", participantId);
    } catch {}
  };
  function clearTimers() {
    if (poorTimer) clearTimeout(poorTimer);
    if (idleTimer) clearTimeout(idleTimer);
    if (exitTimer) clearTimeout(exitTimer);
    poorTimer = idleTimer = exitTimer = null;
  }
  async function detach(sendLeave: boolean) {
    const prior = active;
    active = null;
    clearTimers();
    speaking = false;
    if (!prior) return;
    prior.unsubscribe();
    if (prior.heartbeat) clearInterval(prior.heartbeat);
    try {
      await prior.room.disconnect();
    } catch {}
    if (sendLeave) await postLeave(prior.participantId);
  }
  function readPeople(connection: Connection) {
    if (!current(connection) || !state.call) return;
    const approved = new Map(
      state.call.participants.map((person) => [person.userId, person]),
    );
    const people = connection.room.people();
    const participants: CallParticipant[] = people.flatMap((person) => {
      const id = person.attributes.userId;
      const member = id && approved.get(id);
      if (!id || !member || person.attributes.participantId !== person.identity)
        return [];
      return [
        {
          participantId: person.identity,
          userId: id,
          name: member.name,
          avatar: member.avatar,
          local: person.local,
          speaking: person.speaking,
          microphoneEnabled: person.microphoneEnabled,
          cameraEnabled: person.cameraEnabled,
          screenShareEnabled: person.screenShareEnabled,
          tracks: person.tracks,
        },
      ];
    });
    const local = people.find(
      (person) => person.local && person.identity === connection.participantId,
    );
    update({
      participants,
      remoteAudioTracks: people
        .filter(
          (person) =>
            !person.local &&
            person.identity === person.attributes.participantId &&
            person.attributes.userId,
        )
        .flatMap((person) =>
          person.tracks.filter((track) => track.kind === "audio"),
        ),
      ...(local
        ? {
            microphoneEnabled: local.microphoneEnabled,
            cameraEnabled: local.cameraEnabled,
            screenShareEnabled: local.screenShareEnabled,
          }
        : {}),
    });
  }
  function armIdle(connection: Connection) {
    if (idleTimer) clearTimeout(idleTimer);
    if (exitTimer) clearTimeout(exitTimer);
    idleTimer = exitTimer = null;
    if (state.silencePrompt) update({ silencePrompt: false });
    if (speaking) return;
    idleTimer = setTimeout(() => {
      if (!current(connection)) return;
      update({ silencePrompt: true });
      exitTimer = setTimeout(() => {
        if (current(connection)) void leave();
      }, 60_000);
    }, 30 * 60_000);
  }
  async function endConnection(
    connection: Connection,
    reason: "removed" | "replaced" | "other",
  ) {
    if (!current(connection)) return;
    generation++;
    dismissedRestore = connection.participantId;
    const notice =
      reason === "replaced"
        ? "다른 탭에서 통화에 들어갔어요"
        : reason === "removed"
          ? "통화가 끝났어요"
          : "통화가 끊겼어요. 다시 들어가 주세요";
    update({
      phase: "disconnected",
      participants: [],
      remoteAudioTracks: [],
      silencePrompt: false,
      notice,
      microphoneEnabled: false,
      cameraEnabled: false,
      screenShareEnabled: false,
      reducedQuality: false,
    });
    await detach(reason === "other");
  }
  function receive(connection: Connection, event: CallRoomEvent) {
    if (!current(connection)) return;
    switch (event.type) {
      case "media":
        readPeople(connection);
        break;
      case "connected":
        update({ phase: "connected" });
        readPeople(connection);
        break;
      case "reconnecting":
        update({ phase: "reconnecting" });
        break;
      case "disconnected":
        void endConnection(connection, event.reason);
        break;
      case "autoplay":
        update({ audioAllowed: event.allowed });
        break;
      case "speakers":
        speaking = event.active;
        armIdle(connection);
        readPeople(connection);
        break;
      case "device-error":
        update({
          notice: event.denied
            ? `브라우저 설정에서 ${event.kind === "camera" ? "카메라" : "마이크"}를 허용해 주세요`
            : `${event.kind === "camera" ? "카메라" : "마이크"}가 연결 해제됐어요`,
        });
        readPeople(connection);
        break;
      case "quality":
        if (!event.poor) {
          if (poorTimer) clearTimeout(poorTimer);
          poorTimer = null;
          if (state.reducedQuality) {
            connection.room.reduceVideoQuality(false);
            update({ reducedQuality: false });
          }
        } else if (!poorTimer && !state.reducedQuality) {
          poorTimer = setTimeout(() => {
            poorTimer = null;
            if (current(connection)) {
              connection.room.reduceVideoQuality(true);
              update({ reducedQuality: true });
            }
          }, 5_000);
        }
    }
  }
  async function connect(target: CallTarget, devices: CallDevices) {
    joinRequest++;
    const ownGeneration = ++generation;
    update({
      phase: "connecting",
      call: null,
      check: null,
      restore: null,
      participants: [],
      remoteAudioTracks: [],
      notice: null,
      silencePrompt: false,
      reducedQuality: false,
      audioAllowed: true,
    });
    await detach(true);
    if (ownGeneration !== generation) return;
    let participantId: string | null = null;
    let room: CallRoom | null = null;
    try {
      const result = await deps.join(target.roomId);
      if (!result.ok) {
        if (ownGeneration === generation)
          update({
            phase: "disconnected",
            notice:
              result.message === "call_full"
                ? "통화 인원이 가득 찼어요"
                : "통화에 들어갈 수 없어요. 다시 시도해 주세요",
          });
        return;
      }
      participantId = result.data.participantId;
      if (ownGeneration !== generation) {
        await postLeave(participantId);
        return;
      }
      const sdk = await deps.loadLiveKit();
      if (ownGeneration !== generation) {
        await postLeave(participantId);
        return;
      }
      room = sdk.createRoom({ adaptiveStream: false, dynacast: true });
      const connection: Connection = {
        generation: ownGeneration,
        participantId,
        room,
        unsubscribe: () => {},
        heartbeat: null,
        beating: false,
      };
      active = connection;
      connection.unsubscribe = room.subscribe((event) =>
        receive(connection, event),
      );
      prefs = devices;
      update({
        call: {
          ...target,
          participantId,
          sessionId: result.data.sessionId,
          kind: result.data.kind,
          joinedAt: deps.now(),
        },
      });
      await room.connect(result.data.serverUrl, result.data.token);
      if (!current(connection)) {
        await room.disconnect().catch(() => {});
        return;
      }
      update({ phase: "connected" });
      // 권한 거부는 듣기까지 막지 않는다. 실패한 장치만 꺼진 채로 남긴다.
      await applyDevices(connection, devices);
      if (!current(connection)) return;
      connection.heartbeat = setInterval(async () => {
        if (!current(connection) || connection.beating) return;
        connection.beating = true;
        try {
          if (
            (await deps.post("heartbeat", connection.participantId)) === 404 &&
            current(connection)
          )
            await endConnection(connection, "removed");
        } catch {
        } finally {
          connection.beating = false;
        }
      }, 30_000);
      armIdle(connection);
      readPeople(connection);
    } catch {
      if (ownGeneration !== generation) {
        // SDK 로딩 중 나가도 이미 발급된 참가만 정리한다.
        if (participantId && !room) await postLeave(participantId);
        return;
      }
      generation++;
      await detach(false);
      if (participantId) await postLeave(participantId);
      if (generation === ownGeneration + 1)
        update({
          phase: "disconnected",
          participants: [],
          remoteAudioTracks: [],
          notice: "통화가 끊겼어요. 다시 들어가 주세요",
        });
    }
  }
  async function applyDevices(connection: Connection, devices: CallDevices) {
    const apply = async (camera: boolean) => {
      if (!current(connection)) return;
      try {
        await (camera
          ? connection.room.camera(devices.cameraEnabled, devices.camera)
          : connection.room.microphone(
              devices.microphoneEnabled,
              devices.microphone,
            ));
        if (!current(connection))
          await connection.room.disconnect().catch(() => {});
      } catch (error) {
        if (current(connection))
          update({ notice: deviceErrorMessage(error, camera) });
      }
    };
    await apply(false);
    await apply(true);
    if (!current(connection)) return;
    if (devices.speaker !== "default")
      try {
        await connection.room.switchDevice("audiooutput", devices.speaker);
      } catch {
        if (current(connection))
          update({
            notice: "스피커를 바꾸지 못했어요. 다른 장치를 골라 주세요",
          });
      }
    if (current(connection)) readPeople(connection);
  }
  async function join(target: CallTarget) {
    const request = ++joinRequest;
    if (!enabled) {
      update({ notice: "통화를 쓸 수 없어요" });
      return;
    }
    if (active && state.call?.roomId === target.roomId) return;
    const saved = deps.readDevices();
    if (!saved) {
      update({
        check: {
          target,
          devices: defaultCallDevices(target.roomKind === "meeting"),
          settings: false,
        },
        phase: active ? state.phase : "checking",
      });
      return;
    }
    let devices = saved;
    try {
      devices = availableCallDevices(saved, await deps.enumerateDevices());
    } catch {}
    if (request !== joinRequest) return;
    await connect(target, devices);
  }
  async function leave() {
    joinRequest++;
    generation++;
    if (state.call) dismissedRestore = state.call.participantId;
    update({ ...initialCallSnapshot });
    await detach(true);
  }
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => state,
    getServerSnapshot: () => initialCallSnapshot,
    join,
    leave,
    metadata(next: {
      userId: string | null;
      enabled: boolean;
      myCall: MyCall | null;
      targets: readonly CallTarget[];
    }) {
      if (userId && userId !== next.userId) {
        void leave();
        dismissedRestore = null;
      }
      userId = next.userId;
      enabled = next.enabled;
      targets = next.targets;
      const target =
        state.call &&
        targets.find((item) => item.roomId === state.call?.roomId);
      if (target && state.call) {
        // 탐색 목록은 통화 명부가 아니다. 승인된 방 조회만 명부를 바꾼다.
        update({
          call: {
            ...state.call,
            ...target,
            participants: state.call.participants,
          },
        });
        if (active) readPeople(active);
      }
      if (!active && state.phase !== "connecting")
        update({
          restore:
            next.myCall?.participantId !== dismissedRestore
              ? next.myCall
              : null,
        });
    },
    updateTarget(target: CallTarget) {
      targets = [
        ...targets.filter((item) => item.roomId !== target.roomId),
        target,
      ];
      if (state.call?.roomId === target.roomId) {
        update({ call: { ...state.call, ...target } });
        if (active) readPeople(active);
      }
    },
    async confirmDevices(devices: CallDevices) {
      const check = state.check;
      if (!check) return;
      deps.saveDevices(devices);
      prefs = devices;
      update({ check: null });
      if (check.settings && active) await applyDevices(active, devices);
      else await connect(check.target, devices);
    },
    cancelDeviceCheck() {
      update({
        check: null,
        phase: state.phase === "checking" ? "idle" : state.phase,
      });
    },
    openDeviceCheck() {
      if (state.call)
        update({
          check: { target: state.call, devices: prefs, settings: !!active },
        });
    },
    async toggleMicrophone() {
      const connection = active;
      if (!connection) return;
      prefs = { ...prefs, microphoneEnabled: !state.microphoneEnabled };
      try {
        await connection.room.microphone(
          prefs.microphoneEnabled,
          prefs.microphone,
        );
        if (current(connection)) readPeople(connection);
        else await connection.room.disconnect().catch(() => {});
      } catch (error) {
        if (current(connection)) update({ notice: deviceErrorMessage(error) });
      }
    },
    async toggleCamera() {
      const connection = active;
      if (!connection) return;
      prefs = { ...prefs, cameraEnabled: !state.cameraEnabled };
      try {
        await connection.room.camera(prefs.cameraEnabled, prefs.camera);
        if (current(connection)) readPeople(connection);
        else await connection.room.disconnect().catch(() => {});
      } catch (error) {
        if (current(connection))
          update({ notice: deviceErrorMessage(error, true) });
      }
    },
    async toggleScreenShare() {
      const connection = active;
      if (!connection) return;
      try {
        await connection.room.screenShare(!state.screenShareEnabled);
        if (current(connection)) readPeople(connection);
        else await connection.room.disconnect().catch(() => {});
      } catch {
        if (current(connection))
          update({
            notice: "화면 공유를 시작하지 못했어요. 다시 시도해 주세요",
          });
      }
    },
    async startAudio() {
      const connection = active;
      if (!connection) return;
      try {
        await connection.room.startAudio();
        if (current(connection)) update({ audioAllowed: true });
      } catch {
        if (current(connection)) update({ audioAllowed: false });
      }
    },
    keepStaying() {
      if (active) armIdle(active);
    },
    replaced(participantId: string) {
      if (active?.participantId === participantId)
        void endConnection(active, "replaced");
    },
    async restore() {
      const target =
        state.restore &&
        targets.find((item) => item.roomId === state.restore?.roomId);
      if (target) {
        dismissedRestore = state.restore!.participantId;
        await join(target);
      }
    },
    async dismissRestore() {
      const participantId = state.restore?.participantId;
      if (!participantId) return;
      dismissedRestore = participantId;
      update({ restore: null });
      await postLeave(participantId);
    },
    pagehide() {
      joinRequest++;
      if (active) deps.beacon(active.participantId);
      generation++;
      void detach(false);
      update({ ...initialCallSnapshot });
    },
    async devicesChanged() {
      const connection = active;
      if (!connection) return;
      try {
        const next = availableCallDevices(prefs, await deps.enumerateDevices());
        if (!current(connection)) return;
        if (
          prefs.microphone !== next.microphone ||
          prefs.camera !== next.camera
        )
          update({
            notice: `${prefs.microphone !== next.microphone ? "마이크" : "카메라"}가 연결 해제됐어요`,
          });
      } catch {}
    },
    dispose() {
      joinRequest++;
      generation++;
      void detach(true);
      state = initialCallSnapshot;
    },
  };
}
export type CallController = ReturnType<typeof createCallController>;
