"use client";

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { ChannelMembers } from "./channel-members";

export function RoomMembersPanel({
  members,
  group,
}: {
  members: ComponentProps<typeof ChannelMembers>["members"];
  group?: {
    canAdd: boolean;
    onAction: (action: "add" | "leave", trigger: HTMLButtonElement) => void;
  };
}) {
  return (
    <>
      {group && (
        <Button
          variant="outline"
          className="mx-4 mt-3"
          disabled={!group.canAdd}
          onClick={(event) => group.onAction("add", event.currentTarget)}
        >
          사람 추가
        </Button>
      )}
      <ChannelMembers members={members} />
      {group && (
        <Button
          variant="ghost"
          className="mx-4 mb-4 text-destructive"
          onClick={(event) => group.onAction("leave", event.currentTarget)}
        >
          그룹 나가기
        </Button>
      )}
    </>
  );
}
