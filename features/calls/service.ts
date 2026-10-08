import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import { getLiveKitServer } from "@/lib/calls/livekit-server";
import type { LiveKitServer } from "@/lib/calls/types";
import { canJoinCall } from "@/lib/dal/call-access";
import { callEvents } from "@/lib/dal/call-events";
import {
  readCallParticipant,
  readCallRoom,
  readMyCallParticipant,
  readOpenCall,
  readSessionRoom,
} from "@/lib/dal/call-read";
import {
  beginCallParticipant,
  closeCallParticipant,
  lockCallUser,
  touchCallParticipant,
} from "@/lib/dal/call-write";
import { lockRoomForMessage } from "@/lib/dal/chat-write";
import { withTransaction } from "@/lib/dal/database";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import { userChannel } from "@/lib/realtime/channels";
import { getRealtimePublisher } from "@/lib/realtime/server";
import type { RealtimeItem } from "@/lib/realtime/types";
import type { ChatActionDependencies } from "@/features/chat/action-factory";
import type { JoinedCall } from "./types";

export type CallDependencies = ChatActionDependencies & {
  livekit?: LiveKitServer | null;
};
export type ParticipantInput = { userId: string; participantId: string };
const ringLimiter = createMemoryRateLimiter();
class CallMoveRetry extends Error {}

export function createCallService(dependencies: CallDependencies = {}) {
  const clock = () => dependencies.now?.() ?? new Date();
  const livekit = () =>
    dependencies.livekit === undefined
      ? getLiveKitServer()
      : dependencies.livekit;
  const log = (message: string) =>
    (dependencies.logError ?? console.error)(message);
  const publish = async (events: readonly RealtimeItem[]) => {
    if (!events.length) return;
    try {
      await (dependencies.publisher ?? getRealtimePublisher()).publishMany(
        events,
      );
    } catch {
      log("Call realtime publication failed.");
    }
  };
  const remove = async (
    server: LiveKitServer,
    roomId: string,
    participantId: string,
  ) => {
    try {
      await server.removeParticipant(`call:${roomId}`, participantId);
    } catch {
      log("Call participant removal failed.");
    }
  };

  async function leave(input: ParticipantInput): Promise<boolean> {
    const server = livekit();
    if (!server) return false;
    const participant = await readCallParticipant(
      input.participantId,
      dependencies.database,
    );
    if (!participant || participant.userId !== input.userId) return false;
    if (participant.leftAt !== null) return true;
    const now = clock();
    const result = await withTransaction(async (tx) => {
      await lockCallUser(input.userId, tx);
      await lockRoomForMessage(participant.roomId, tx);
      const result = await closeCallParticipant(
        input.participantId,
        participant.sessionId,
        now,
        tx,
      );
      return {
        changed: result.changed,
        events: result.changed
          ? await callEvents(participant.roomId, now, result.messages, tx)
          : [],
      };
    }, dependencies.database);
    if (result.changed) {
      await remove(server, participant.roomId, input.participantId);
      await publish(result.events);
    }
    return true;
  }

  async function join(session: Session, roomId: string): Promise<JoinedCall> {
    const server = livekit();
    if (!server) throw new ActionError("FORBIDDEN");
    const initial = await canJoinCall(
      session.userId,
      roomId,
      clock(),
      dependencies.database,
    );
    if (!initial.room) throw new ActionError("NOT_FOUND");
    if (!initial.canJoin) throw new ActionError("FORBIDDEN");
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const prior = await readMyCallParticipant(
        session.userId,
        dependencies.database,
      );
      if (prior && prior.roomId !== roomId)
        await leave({ userId: session.userId, participantId: prior.id });
      const now = clock();
      try {
        const result = await withTransaction(async (tx) => {
          const user = await lockCallUser(session.userId, tx);
          const current = await readMyCallParticipant(session.userId, tx);
          // 이동 사이 다른 탭이 들어갔으면 두 번째 방을 잠그지 않고 새 트랜잭션으로 돌아간다.
          if (current && current.roomId !== roomId) throw new CallMoveRetry();
          await lockRoomForMessage(roomId, tx);
          const access = await canJoinCall(session.userId, roomId, now, tx);
          if (!access.room) throw new ActionError("NOT_FOUND");
          if (!access.canJoin) throw new ActionError("FORBIDDEN");
          const capacity =
            access.room.kind === "voice" ? access.room.voiceCapacity! : 10;
          const joined = await beginCallParticipant(
            {
              roomId,
              userId: user.id,
              name: user.name,
              kind: access.room.kind === "voice" ? "voice" : "huddle",
              capacity,
              now,
            },
            tx,
          );
          const events = await callEvents(roomId, now, joined.messages, tx);
          const room = await readCallRoom(roomId, tx);
          return { ...joined, name: user.name, capacity, events, room };
        }, dependencies.database);
        for (const participantId of result.replaced)
          await remove(server, roomId, participantId);
        await publish([
          ...result.replaced.map((participantId): RealtimeItem => ({
            channel: userChannel(session.userId),
            event: { type: "call.replaced", participantId },
          })),
          ...result.events,
        ]);
        let token: string;
        try {
          token = await server.issueToken({
            participantId: result.participantId,
            userId: session.userId,
            name: result.name,
            room: `call:${roomId}`,
            maxParticipants: result.capacity,
          });
        } catch {
          await leave({
            userId: session.userId,
            participantId: result.participantId,
          });
          throw new ActionError("INTERNAL");
        }
        if (result.created && result.room?.kind === "dm") {
          const peer =
            result.room.dmLowUserId === session.userId
              ? result.room.dmHighUserId
              : result.room.dmLowUserId;
          if (
            peer &&
            (dependencies.limiter ?? ringLimiter).consume(
              `call-ring:${session.userId}:${peer}`,
              1,
              30_000,
            ).allowed
          )
            await publish([
              {
                channel: userChannel(peer),
                event: {
                  type: "call.ringing",
                  roomId,
                  sessionId: result.session.id,
                  callerId: session.userId,
                  callerName: result.name,
                },
              },
            ]);
        }
        return {
          participantId: result.participantId,
          sessionId: result.session.id,
          serverUrl: server.serverUrl,
          token,
          room: `call:${roomId}`,
          kind: result.session.kind,
        };
      } catch (error) {
        if (error instanceof CallMoveRetry) continue;
        throw error;
      }
    }
    throw new ActionError("INTERNAL");
  }

  return {
    join,
    leave,
    async heartbeat(input: ParticipantInput) {
      if (!livekit()) return false;
      // DB 기본값은 DAL에서만 만들고, 테스트는 같은 DB를 주입한다.
      return touchCallParticipant(
        input.userId,
        input.participantId,
        clock(),
        dependencies.database,
      );
    },
    async decline(session: Session, sessionId: string) {
      if (!livekit()) throw new ActionError("FORBIDDEN");
      const events = await withTransaction(async (tx) => {
        await lockCallUser(session.userId, tx);
        const participant = await readSessionRoom(sessionId, tx);
        if (!participant) throw new ActionError("NOT_FOUND");
        await lockRoomForMessage(participant.roomId, tx);
        const open = await readOpenCall(participant.roomId, tx, true);
        const access = await canJoinCall(
          session.userId,
          participant.roomId,
          clock(),
          tx,
        );
        if (
          !open ||
          open.id !== sessionId ||
          open.kind !== "huddle" ||
          !open.startedBy ||
          open.startedBy === session.userId ||
          !access.canJoin ||
          access.room?.kind !== "dm"
        )
          throw new ActionError("NOT_FOUND");
        return [open.startedBy, session.userId].map((userId): RealtimeItem => ({
          channel: userChannel(userId),
          event: {
            type: "call.declined",
            sessionId,
            roomId: participant.roomId,
          },
        }));
      }, dependencies.database);
      await publish(events);
      return {};
    },
  };
}
