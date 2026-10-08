"use client";
import { UserAvatar } from "@/components/user-avatar";
import type { Avatar } from "@/lib/avatar";
import type { ReactNode, RefObject } from "react";
import { Hash, MoreHorizontal, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PersonCard } from "@/features/people/components/person-card";
import { PersonStatus } from "@/features/people/components/person-status";
import type { MessageContact } from "@/features/people/types";
import type { RoomMessageSource } from "../room-message-source";
import { ChatMuteButton } from "./chat-mute-button";
import type { MessageRequestState } from "./message-request-banner";

export type DirectOther = {
  avatar: Avatar;
  userId: string;
  name: string;
  username: string | null;
  sharesSpace: boolean;
};
export type ChatRoomPresentation =
  | { kind: "channel"; name: string; topic: string | null; archived: boolean }
  | {
      kind: "dm";
      other: DirectOther;
      peerReadSeq: number;
      request: MessageRequestState;
      blockedByMe: boolean;
    }
  | {
      kind: "group_dm";
      archived: boolean;
      name: string;
      originalName: string | null;
      contacts?: Promise<MessageContact[]>;
    };

export function ChatRoomHeader({
  data,
  presentation,
  roomName,
  trigger,
  membersOpen,
  membersId,
  onToggleMembers,
  groupMenu,
  groupDialogOpen,
  onRename,
  fileAction,
}: {
  data: RoomMessageSource;
  presentation: ChatRoomPresentation;
  roomName: string;
  trigger: RefObject<HTMLButtonElement | null>;
  membersOpen: boolean;
  membersId: string;
  onToggleMembers: () => void;
  groupMenu: RefObject<HTMLButtonElement | null>;
  groupDialogOpen: boolean;
  onRename: () => void;
  fileAction?: ReactNode;
}) {
  const direct = presentation.kind === "dm" ? presentation : null;
  const group = presentation.kind === "group_dm" ? presentation : null;
  return (
    <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4 md:px-6">
      {direct ? (
        <>
          <UserAvatar
            name={direct.other.name}
            avatar={direct.other.avatar}
            size={40}
            status={
              <PersonStatus
                userId={direct.other.userId}
                sharesSpace={direct.other.sharesSpace}
              />
            }
          />
          <h1 className="min-w-0 truncate text-lg font-bold">
            <PersonCard userId={direct.other.userId} name={direct.other.name}>
              <button
                type="button"
                className="min-h-11 max-w-full truncate rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
                aria-label={`${direct.other.name} 프로필`}
              >
                {direct.other.name}
              </button>
            </PersonCard>
          </h1>
          {direct.other.username && (
            <span className="hidden truncate text-sm text-muted-foreground sm:block">
              @{direct.other.username}
            </span>
          )}
        </>
      ) : (
        <>
          {group ? (
            <Users
              aria-hidden="true"
              className="size-5 shrink-0 text-muted-foreground"
            />
          ) : (
            <Hash
              aria-hidden="true"
              className="size-5 shrink-0 text-muted-foreground"
            />
          )}
          <h1 className="truncate text-lg font-bold">{roomName}</h1>
          {presentation.kind === "channel" && presentation.topic && (
            <p className="hidden min-w-0 flex-1 truncate border-l border-border pl-3 text-sm text-muted-foreground sm:block">
              {presentation.topic}
            </p>
          )}
        </>
      )}
      <div className="ml-auto flex shrink-0 items-center gap-1">
        {fileAction}
        <ChatMuteButton
          id={data.room.id}
          name={roomName}
          muted={data.room.muted}
        />
        {!direct && (
          <Button
            ref={trigger}
            type="button"
            variant="ghost"
            aria-label={`멤버 ${data.members.length}명`}
            aria-expanded={membersOpen}
            aria-controls={membersId}
            onClick={onToggleMembers}
          >
            <Users aria-hidden="true" />
            <span className="tabular-nums">{data.members.length}</span>
          </Button>
        )}
        {group && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                ref={groupMenu}
                variant="ghost"
                size="icon"
                aria-label="그룹 더보기"
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              onCloseAutoFocus={(event) => {
                if (groupDialogOpen) event.preventDefault();
              }}
            >
              <DropdownMenuItem disabled={!data.canWrite} onSelect={onRename}>
                이름 바꾸기
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
