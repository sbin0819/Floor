import type { MessageContact } from "@/features/people/types";
import type { ChatNav } from "./types";
import { groupDisplayName } from "./group-name";
import { meetingName } from "./meeting-format";

export type QuickSwitchItem = {
  id: string;
  kind: "room" | "space" | "person";
  label: string;
  search: string;
  href: string | null;
  unread: boolean;
};

export function normalizeQuickSearch(value: string) {
  return value.normalize("NFC").trim().toLowerCase();
}

export function quickSwitchItems(
  nav: ChatNav | undefined,
  people: readonly MessageContact[],
): QuickSwitchItem[] {
  if (!nav) return [];
  return [
    ...nav.spaces.flatMap((space) => [
      ...space.channels.map((room) => ({
        id: room.id,
        kind: "room" as const,
        label: `#${room.name} · ${space.name}`,
        search: normalizeQuickSearch(`${room.name} ${space.name}`),
        href: `/s/${space.id}/${room.id}`,
        unread: room.unread && !room.muted && !space.muted,
      })),
      {
        id: space.id,
        kind: "space" as const,
        label: space.name,
        search: normalizeQuickSearch(space.name),
        href: `/s/${space.id}`,
        unread: false,
      },
    ]),
    ...nav.directMessages.map((room) => {
      const label =
        room.kind === "dm"
          ? room.other.name
          : groupDisplayName(
              room.name,
              room.members.map(({ name }) => name),
              room.memberCount - 1,
            );
      return {
        id: room.roomId,
        kind: "room" as const,
        label,
        search: normalizeQuickSearch(
          `${label} ${room.kind === "dm" ? (room.other.username ?? "") : room.members.map(({ name }) => name).join(" ")}`,
        ),
        href: `/dm/${room.roomId}`,
        unread: room.unread && !room.muted,
      };
    }),
    ...nav.meetings.map((room) => ({
      id: room.roomId,
      kind: "room" as const,
      label: meetingName(room),
      search: normalizeQuickSearch(`${meetingName(room)} ${room.spaceName}`),
      href: `/m/${room.bookingId}`,
      unread: room.unread && !room.muted,
    })),
    ...people
      .filter((person) => !nav.blockedUserIds.includes(person.userId))
      .map((person) => ({
        id: person.userId,
        kind: "person" as const,
        label: `${person.name}${person.username ? ` · @${person.username}` : ""}`,
        search: normalizeQuickSearch(`${person.name} ${person.username ?? ""}`),
        href: person.directRoomId ? `/dm/${person.directRoomId}` : null,
        unread: false,
      })),
  ];
}

export function filterQuickSwitchItems(
  items: readonly QuickSwitchItem[],
  search: string,
  recent: readonly string[],
): QuickSwitchItem[] {
  const query = normalizeQuickSearch(search);
  if (query) return items.filter((item) => item.search.includes(query));
  const rooms = items.filter((item) => item.kind === "room");
  const recentRooms = recent.flatMap(
    (id) => rooms.find((room) => room.id === id) ?? [],
  );
  const seen = new Set(recentRooms.map((room) => room.id));
  return [
    ...recentRooms,
    ...rooms.filter((room) => room.unread && !seen.has(room.id)),
  ];
}

export function quickSwitchShortcut(
  event: Pick<
    KeyboardEvent,
    | "key"
    | "metaKey"
    | "ctrlKey"
    | "altKey"
    | "shiftKey"
    | "isComposing"
    | "keyCode"
  >,
  platform: string,
) {
  return (
    !event.isComposing &&
    event.keyCode !== 229 &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "k" &&
    (/mac|iphone|ipad/i.test(platform) ? event.metaKey : event.ctrlKey)
  );
}
