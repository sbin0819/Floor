import type { QueryClient } from "@tanstack/react-query";
import type { ChatSpaceNav } from "./types";

export const CHAT_NAV_KEY = ["chat", "nav"] as const;
type NavChanges = {
  revision: number;
  rooms: Map<string, number>;
  activitySeq: Map<string, number>;
  readThrough: Map<string, number>;
  incoming: WeakSet<ChatSpaceNav[]>;
  viewport: { roomId: string; atBottom: boolean } | null;
  mentions: Set<string>;
};
const changes = new WeakMap<QueryClient, NavChanges>();
function state(client: QueryClient) {
  let value = changes.get(client);
  if (!value) {
    value = {
      revision: 0,
      rooms: new Map(),
      activitySeq: new Map(),
      readThrough: new Map(),
      incoming: new WeakSet(),
      viewport: null,
      mentions: new Set(),
    };
    changes.set(client, value);
  }
  return value;
}

export function reportRoomViewport(
  client: QueryClient,
  roomId: string,
  atBottom: boolean,
) {
  state(client).viewport = { roomId, atBottom };
}

export function releaseRoomViewport(client: QueryClient, roomId: string) {
  if (state(client).viewport?.roomId === roomId) state(client).viewport = null;
}

function setUnread(client: QueryClient, roomId: string, unread: boolean) {
  const snapshot = state(client);
  snapshot.rooms.set(roomId, ++snapshot.revision);
  client.setQueryData<ChatSpaceNav[]>(CHAT_NAV_KEY, (current) =>
    current?.map((space) => {
      const channels = space.channels.map((room) =>
        room.id === roomId
          ? { ...room, unread, ...(!unread ? { unreadMentions: 0 } : {}) }
          : room,
      );
      return {
        ...space,
        channels,
        unread:
          !space.muted && channels.some((room) => room.unread && !room.muted),
        unreadMentions: channels.reduce(
          (sum, room) => sum + room.unreadMentions,
          0,
        ),
      };
    }),
  );
}

export function clearRoomUnread(
  client: QueryClient,
  roomId: string,
  throughSeq?: number,
  ifUnchangedSince?: number,
) {
  const snapshot = state(client);
  if (throughSeq !== undefined) {
    snapshot.readThrough.set(
      roomId,
      Math.max(snapshot.readThrough.get(roomId) ?? 0, throughSeq),
    );
    if ((snapshot.activitySeq.get(roomId) ?? 0) > throughSeq) return;
  }
  if (
    ifUnchangedSince !== undefined &&
    (snapshot.rooms.get(roomId) ?? 0) > ifUnchangedSince
  )
    return;
  setUnread(client, roomId, false);
}

export function applyRoomActivity(
  client: QueryClient,
  event: { roomId: string; authorId: string | null; seq: number },
  userId: string,
) {
  const snapshot = state(client);
  const viewport = snapshot.viewport;
  if (
    event.authorId === userId ||
    event.seq <= (snapshot.readThrough.get(event.roomId) ?? 0) ||
    (viewport?.roomId === event.roomId &&
      viewport.atBottom &&
      document.visibilityState === "visible")
  )
    return;
  snapshot.activitySeq.set(
    event.roomId,
    Math.max(snapshot.activitySeq.get(event.roomId) ?? 0, event.seq),
  );
  setUnread(client, event.roomId, true);
}

export function chatNavRevision(client: QueryClient) {
  return state(client).revision;
}

export function isViewingRoom(
  client: QueryClient,
  roomId: string,
  bottomOnly = false,
) {
  const viewport = state(client).viewport;
  return (
    viewport?.roomId === roomId &&
    (!bottomOnly || viewport.atBottom) &&
    document.visibilityState === "visible"
  );
}

export function applyMention(
  client: QueryClient,
  event: { roomId: string; messageId: string; seq: number },
) {
  const snapshot = state(client);
  if (snapshot.mentions.has(event.messageId)) return false;
  snapshot.mentions.add(event.messageId);
  if (
    event.seq <= (snapshot.readThrough.get(event.roomId) ?? 0) ||
    isViewingRoom(client, event.roomId, true)
  )
    return false;
  snapshot.rooms.set(event.roomId, ++snapshot.revision);
  snapshot.activitySeq.set(
    event.roomId,
    Math.max(snapshot.activitySeq.get(event.roomId) ?? 0, event.seq),
  );
  client.setQueryData<ChatSpaceNav[]>(CHAT_NAV_KEY, (current) =>
    current?.map((space) => {
      const channels = space.channels.map((room) =>
        room.id === event.roomId
          ? { ...room, unreadMentions: room.unreadMentions + 1 }
          : room,
      );
      return {
        ...space,
        channels,
        unreadMentions: channels.reduce(
          (sum, room) => sum + room.unreadMentions,
          0,
        ),
      };
    }),
  );
  return true;
}

// 요청 이후 바뀐 방만 현재 값을 남긴다. 다음 정상 폴링은 실패한 읽음도 바로잡는다.
export function mergeChatNav(
  client: QueryClient,
  incoming: ChatSpaceNav[],
  requestedAt: number | null,
) {
  const snapshot = state(client);
  const current = client.getQueryData<ChatSpaceNav[]>(CHAT_NAV_KEY);
  const unread = new Map(
    current?.flatMap((space) =>
      space.channels.map(
        (room) =>
          [
            room.id,
            { unread: room.unread, unreadMentions: room.unreadMentions },
          ] as const,
      ),
    ),
  );
  return incoming.map((space) => {
    const channels = space.channels.map((room) => {
      const protect =
        requestedAt === null
          ? unread.has(room.id)
          : (snapshot.rooms.get(room.id) ?? 0) > requestedAt;
      if (protect && unread.has(room.id))
        return { ...room, ...unread.get(room.id)! };
      if (requestedAt !== null)
        snapshot.rooms.set(room.id, ++snapshot.revision);
      return room;
    });
    return {
      ...space,
      channels,
      unread:
        !space.muted && channels.some((room) => room.unread && !room.muted),
      unreadMentions: channels.reduce(
        (sum, room) => sum + room.unreadMentions,
        0,
      ),
    };
  });
}

export function mergeInitialChatNav(
  client: QueryClient,
  incoming: ChatSpaceNav[],
) {
  const snapshot = state(client);
  if (snapshot.incoming.has(incoming)) return;
  snapshot.incoming.add(incoming);
  client.setQueryData(CHAT_NAV_KEY, mergeChatNav(client, incoming, null));
}
