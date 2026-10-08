import { ActionError } from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";
import type { DalDatabase } from "@/lib/dal/database";
import { directPeerAccess } from "@/lib/dal/direct-permission";
import {
  changeDirectMember,
  countPendingMessages,
  deleteMessageRequestNotification,
  requestCooldownMs,
  requireRequestCapacity,
  renewMessageRequestNotification,
} from "@/lib/dal/direct-requests";
import { roomChannel, userChannel } from "@/lib/realtime/channels";
import type { RealtimeItem } from "@/lib/realtime/types";
import { lockRoomMembers } from "@/lib/dal/chat-write";

// 이미 사용자와 방을 잠그고 clientId 중복을 확인한 뒤에만 호출한다.
export async function prepareDirectSend(
  input: {
    roomId: string;
    peerId: string;
    session: Session;
    now: Date;
    reopenDeclined?: boolean;
  },
  database: DalDatabase,
) {
  const { roomId, peerId, session, now } = input;
  const members = await lockRoomMembers(roomId, database);
  const mine = members.find((row) => row.userId === session.userId);
  const peer = members.find((row) => row.userId === peerId);
  if (
    !mine ||
    !peer ||
    mine.status === "left" ||
    (mine.status === "declined" && !input.reopenDeclined)
  )
    throw new ActionError("NOT_FOUND");
  const access = await directPeerAccess(session.userId, peerId, database);
  if (access.blocked) throw new ActionError("FORBIDDEN");
  if (peer.status === "left") throw new ActionError("FORBIDDEN");
  const events: RealtimeItem[] = [];
  const clearNotification = async (recipient: string, actor: string) => {
    const removed = await deleteMessageRequestNotification(
      recipient,
      actor,
      database,
    );
    if (removed.length)
      events.push({
        channel: userChannel(recipient),
        event: { type: "notifications.changed" },
      });
  };
  const activate = async (member: typeof mine) => {
    if (member.status === "active") return;
    await changeDirectMember(
      {
        roomId,
        userId: member.userId,
        from: member.status,
        status: "active",
        now,
      },
      database,
    );
    member.status = "active";
  };
  if (
    access.related &&
    (mine.status !== "active" || peer.status !== "active")
  ) {
    await activate(mine);
    await activate(peer);
    await clearNotification(session.userId, peerId);
    await clearNotification(peerId, session.userId);
    events.push(
      { channel: roomChannel(roomId), event: { type: "room.changed", roomId } },
      { channel: userChannel(peerId), event: { type: "friend.changed" } },
    );
  } else if (mine.status === "requested" || mine.status === "declined") {
    await activate(mine);
    await clearNotification(session.userId, peerId);
    events.push(
      { channel: roomChannel(roomId), event: { type: "room.changed", roomId } },
      { channel: userChannel(peerId), event: { type: "friend.changed" } },
    );
  }
  if (peer.status === "active") return { pending: false, events };
  if (peer.statusChangedAt.getTime() <= now.getTime() - requestCooldownMs) {
    await requireRequestCapacity(session.userId, now, database);
    await changeDirectMember(
      {
        roomId,
        userId: peerId,
        from: peer.status,
        status: "requested",
        now,
        newRequest: true,
      },
      database,
    );
    await renewMessageRequestNotification(
      { userId: peerId, actorId: session.userId, actorName: session.name, now },
      database,
    );
    events.push(
      {
        channel: userChannel(peerId),
        event: { type: "notifications.changed" },
      },
      { channel: userChannel(peerId), event: { type: "friend.changed" } },
    );
  } else {
    if (!peer.requestedAt) throw new ActionError("INTERNAL");
    if (
      (await countPendingMessages(
        roomId,
        session.userId,
        peer.requestedAt,
        database,
      )) >= 3
    )
      throw new ActionError("LIMIT_EXCEEDED", { message: "request_pending" });
    if (peer.status === "requested")
      events.push({
        channel: userChannel(peerId),
        event: { type: "friend.changed" },
      });
  }
  return { pending: true, events };
}
