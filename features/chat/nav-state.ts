import type { QueryClient } from "@tanstack/react-query";
import type { ChatSpaceNav } from "./types";

export const CHAT_NAV_KEY = ["chat", "nav"] as const;
type NavChanges = {
  revision: number;
  rooms: Map<string, number>;
  dirty: Set<string>;
  incoming: WeakSet<ChatSpaceNav[]>;
  viewport: { roomId: string; atBottom: boolean } | null;
};
const changes = new WeakMap<QueryClient, NavChanges>();
function state(client: QueryClient) {
  let value = changes.get(client);
  if (!value) {
    value = {
      revision: 0,
      rooms: new Map(),
      dirty: new Set(),
      incoming: new WeakSet(),
      viewport: null,
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
  snapshot.dirty.add(roomId);
  client.setQueryData<ChatSpaceNav[]>(CHAT_NAV_KEY, (current) =>
    current?.map((space) => {
      const channels = space.channels.map((room) =>
        room.id === roomId ? { ...room, unread } : room,
      );
      return {
        ...space,
        channels,
        unread: channels.some((room) => room.unread),
      };
    }),
  );
}

export function clearRoomUnread(client: QueryClient, roomId: string) {
  setUnread(client, roomId, false);
}

export function applyRoomActivity(
  client: QueryClient,
  event: { roomId: string; authorId: string | null },
  userId: string,
) {
  const viewport = state(client).viewport;
  if (
    event.authorId === userId ||
    (viewport?.roomId === event.roomId &&
      viewport.atBottom &&
      document.visibilityState === "visible")
  )
    return;
  setUnread(client, event.roomId, true);
}

export function chatNavRevision(client: QueryClient) {
  return state(client).revision;
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
      space.channels.map((room) => [room.id, room.unread] as const),
    ),
  );
  return incoming.map((space) => {
    const channels = space.channels.map((room) => {
      const protect =
        requestedAt === null
          ? snapshot.dirty.has(room.id)
          : (snapshot.rooms.get(room.id) ?? 0) > requestedAt;
      if (protect && unread.has(room.id))
        return { ...room, unread: unread.get(room.id)! };
      if (requestedAt !== null) snapshot.dirty.delete(room.id);
      return room;
    });
    return { ...space, channels, unread: channels.some((room) => room.unread) };
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
