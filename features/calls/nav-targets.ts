import type { ChatNav } from "@/features/chat/types";
import { groupDisplayName } from "@/features/chat/group-name";
import { meetingName } from "@/features/chat/meeting-format";
import type { CallTarget } from "./client/types";

export function callNavigationTargets(nav: ChatNav): CallTarget[] {
  return [
    ...nav.spaces.flatMap((space) => [
      ...space.channels.map((room): CallTarget => ({
        roomId: room.id,
        roomKind: "text",
        name: room.name,
        href: `/s/${space.id}/${room.id}`,
        participants: [],
      })),
      ...space.voiceChannels.map((room): CallTarget => ({
        roomId: room.id,
        roomKind: "voice",
        name: room.name,
        href: `/s/${space.id}/${room.id}`,
        participants: space.kind === "branch" ? [] : room.participants,
      })),
    ]),
    ...nav.directMessages.map((room): CallTarget => ({
      roomId: room.roomId,
      roomKind: room.kind,
      name:
        room.kind === "dm"
          ? room.other.name
          : groupDisplayName(
              room.name,
              room.members.map((member) => member.name),
              room.memberCount - 1,
            ),
      href: `/dm/${room.roomId}`,
      participants: [],
    })),
    ...nav.meetings.map((room): CallTarget => ({
      roomId: room.roomId,
      roomKind: "meeting",
      name: meetingName(room),
      href: `/m/${room.bookingId}`,
      participants: [],
    })),
  ];
}
