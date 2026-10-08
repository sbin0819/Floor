import "server-only";

import { canReadRoom, writableRoom } from "./chat-access";
import type { DalDatabase } from "./database";

export type CallRoom = NonNullable<Awaited<ReturnType<typeof canReadRoom>>>;

export function joinableCall(room: CallRoom, now: Date): boolean {
  if (room.archivedAt !== null) return false;
  if (room.kind === "voice") return true;
  if (room.adminOnly || !writableRoom(room, now)) return false;
  if (room.kind === "dm")
    return (
      room.directMembership?.mine === "active" &&
      room.directMembership.peer === "active"
    );
  if (room.kind === "meeting")
    return (
      room.booking !== null &&
      now.getTime() >= new Date(room.booking.start).getTime() - 600_000 &&
      now.getTime() < new Date(room.booking.end).getTime()
    );
  return true;
}

export function stayableCall(room: CallRoom): boolean {
  if (room.archivedAt !== null) return false;
  if (room.kind === "dm")
    return (
      !room.peerBlocked &&
      room.directMembership?.mine === "active" &&
      room.directMembership.peer === "active"
    );
  if (room.kind === "meeting") return room.booking?.status === "confirmed";
  return true;
}

export async function canJoinCall(
  userId: string,
  roomId: string,
  now: Date,
  database?: DalDatabase,
) {
  const room = await canReadRoom(userId, roomId, database);
  return { room, canJoin: room !== null && joinableCall(room, now) };
}

export async function canStayInCall(
  userId: string,
  roomId: string,
  database?: DalDatabase,
) {
  const room = await canReadRoom(userId, roomId, database);
  return room !== null && stayableCall(room);
}
