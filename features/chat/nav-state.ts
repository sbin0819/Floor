import type { QueryClient } from "@tanstack/react-query";
import type { ChatNav, DirectMessageNav } from "./types";

export const CHAT_NAV_KEY = ["chat", "nav"] as const;
type NavChanges = {
  revision: number;
  statusRevision: number;
  lastStatus?: ChatNav["myStatus"];
  rooms: Map<string, number>;
  activitySeq: Map<string, number>;
  readThrough: Map<string, number>;
  incoming: WeakSet<ChatNav>;
  viewport: { roomId: string; atBottom: boolean } | null;
  mentions: Set<string>;
};
const changes = new WeakMap<QueryClient, NavChanges>();
function state(client: QueryClient) {
  let value = changes.get(client);
  if (!value) {
    value = {
      revision: 0,
      statusRevision: 0,
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
  client.setQueryData<ChatNav>(
    CHAT_NAV_KEY,
    (current) =>
      current && {
        ...current,
        meetings: current.meetings.map((room) =>
          room.roomId === roomId
            ? { ...room, unread, ...(!unread ? { unreadMentions: 0 } : {}) }
            : room,
        ),
        directMessages: current.directMessages.map((room) =>
          room.roomId === roomId
            ? {
                ...room,
                unread,
                ...(!unread ? { unreadCount: 0, unreadMentions: 0 } : {}),
              }
            : room,
        ),
        spaces: current.spaces.map((space) => {
          const channels = space.channels.map((room) =>
            room.id === roomId
              ? { ...room, unread, ...(!unread ? { unreadMentions: 0 } : {}) }
              : room,
          );
          return {
            ...space,
            channels,
            unread:
              !space.muted &&
              channels.some((room) => room.unread && !room.muted),
            unreadMentions: channels.reduce(
              (sum, room) => sum + room.unreadMentions,
              0,
            ),
          };
        }),
      },
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

export function hasReadThrough(
  client: QueryClient,
  roomId: string,
  seq: number,
) {
  return (state(client).readThrough.get(roomId) ?? 0) >= seq;
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
  client.setQueryData<ChatNav>(
    CHAT_NAV_KEY,
    (current) =>
      current && {
        ...current,
        meetings: current.meetings.map((room) =>
          room.roomId === event.roomId
            ? { ...room, unreadMentions: room.unreadMentions + 1 }
            : room,
        ),
        directMessages: current.directMessages.map((room) =>
          room.roomId === event.roomId
            ? { ...room, unreadMentions: room.unreadMentions + 1 }
            : room,
        ),
        spaces: current.spaces.map((space) => {
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
      },
  );
  return true;
}

// 요청 이후 바뀐 방만 현재 값을 남긴다. 다음 정상 폴링은 실패한 읽음도 바로잡는다.
export function mergeChatNav(
  client: QueryClient,
  incoming: ChatNav,
  requestedAt: number | null,
) {
  const snapshot = state(client);
  const current = client.getQueryData<ChatNav>(CHAT_NAV_KEY);
  const unread = new Map(
    current?.spaces.flatMap((space) =>
      space.channels.map(
        (room) =>
          [
            room.id,
            { unread: room.unread, unreadMentions: room.unreadMentions },
          ] as const,
      ),
    ),
  );
  const spaces = incoming.spaces.map((space) => {
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
  const existing = new Map(
    current?.directMessages.map((room) => [room.roomId, room]),
  );
  const previousMeetings = new Map(
    current?.meetings.map((room) => [room.roomId, room]),
  );
  const meetings = incoming.meetings.map((room) => {
    const old = previousMeetings.get(room.roomId);
    const protect =
      requestedAt === null
        ? Boolean(old)
        : (snapshot.rooms.get(room.roomId) ?? 0) > requestedAt;
    if (old && protect)
      return {
        ...room,
        unread: old.unread,
        unreadMentions: old.unreadMentions,
      };
    if (requestedAt !== null)
      snapshot.rooms.set(room.roomId, ++snapshot.revision);
    return room;
  });
  const protect = (id: string) =>
    requestedAt === null
      ? existing.has(id)
      : (snapshot.rooms.get(id) ?? 0) > requestedAt;
  const directMessages = incoming.directMessages.map((room) => {
    const old = existing.get(room.roomId);
    if (old && protect(room.roomId))
      return {
        ...room,
        lastSeq: old.lastSeq,
        lastMessageAt: old.lastMessageAt,
        unread: old.unread,
        unreadCount: old.unreadCount,
        unreadMentions: old.unreadMentions,
      };
    if (requestedAt !== null)
      snapshot.rooms.set(room.roomId, ++snapshot.revision);
    return room;
  });
  for (const [id, room] of existing) {
    if (protect(id) && !directMessages.some((row) => row.roomId === id))
      directMessages.push(room);
  }
  if (requestedAt !== null && snapshot.statusRevision <= requestedAt)
    snapshot.lastStatus = undefined;
  return {
    ...incoming,
    myStatus:
      requestedAt === null || snapshot.statusRevision > requestedAt
        ? (snapshot.lastStatus ?? current?.myStatus ?? incoming.myStatus)
        : incoming.myStatus,
    spaces,
    meetings,
    directMessages: sortDirectMessages(directMessages),
  };
}

export function applyMyStatus(
  client: QueryClient,
  status: ChatNav["myStatus"],
) {
  const snapshot = state(client);
  snapshot.lastStatus = status;
  snapshot.statusRevision = ++snapshot.revision;
  client.setQueryData<ChatNav>(
    CHAT_NAV_KEY,
    (current) => current && { ...current, myStatus: status },
  );
}

export function pendingMyStatus(client: QueryClient) {
  return state(client).lastStatus;
}

export function mergeInitialChatNav(client: QueryClient, incoming: ChatNav) {
  const snapshot = state(client);
  if (snapshot.incoming.has(incoming)) return;
  snapshot.incoming.add(incoming);
  const current = client.getQueryData<ChatNav>(CHAT_NAV_KEY);
  // 오래 걸린 RSC 응답이 권한 변경 뒤 받은 새 목록을 되돌리지 않게 한다.
  if (current && Date.parse(incoming.now) < Date.parse(current.now)) return;
  client.setQueryData(CHAT_NAV_KEY, mergeChatNav(client, incoming, null));
}

function sortDirectMessages(rows: DirectMessageNav[]) {
  return rows
    .sort(
      (a, b) =>
        b.lastMessageAt.localeCompare(a.lastMessageAt) ||
        a.roomId.localeCompare(b.roomId),
    )
    .slice(0, 50);
}

// 멘션보다 먼저 저장된 번호만 비교해 이벤트 순서가 달라도 일반 메시지 수를 한 번만 올린다.
export function applyDirectActivity(
  client: QueryClient,
  event: { roomId: string; seq: number; authorId: string | null },
  userId: string,
  at = new Date().toISOString(),
) {
  const current = client.getQueryData<ChatNav>(CHAT_NAV_KEY);
  const room = current?.directMessages.find(
    (room) => room.roomId === event.roomId,
  );
  if (!room) return "missing" as const;
  if (event.seq <= room.lastSeq) return "duplicate" as const;
  const snapshot = state(client);
  const unread =
    event.authorId !== userId &&
    event.seq > (snapshot.readThrough.get(event.roomId) ?? 0) &&
    !isViewingRoom(client, event.roomId, true);
  snapshot.rooms.set(event.roomId, ++snapshot.revision);
  snapshot.activitySeq.set(
    event.roomId,
    Math.max(snapshot.activitySeq.get(event.roomId) ?? 0, event.seq),
  );
  client.setQueryData<ChatNav>(CHAT_NAV_KEY, {
    ...current!,
    directMessages: sortDirectMessages(
      current!.directMessages.map((row) =>
        row.roomId === event.roomId
          ? {
              ...row,
              lastSeq: event.seq,
              lastMessageAt: at,
              unread: row.unread || unread,
              unreadCount: Math.min(100, row.unreadCount + (unread ? 1 : 0)),
            }
          : row,
      ),
    ),
  });
  return "applied" as const;
}

export function directUnreadCount(data: Pick<ChatNav, "directMessages">) {
  return data.directMessages.reduce(
    (sum, room) => sum + (room.muted ? room.unreadMentions : room.unreadCount),
    0,
  );
}

export function homeUnreadCount(
  data: Pick<ChatNav, "directMessages" | "meetings">,
) {
  return (
    directUnreadCount(data) +
    data.meetings.reduce((sum, room) => sum + room.unreadMentions, 0)
  );
}
