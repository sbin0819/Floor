"use client";

import { useRef, useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { sendMessageRequest } from "@/features/chat/actions";
import {
  MessageRequestDialog,
  type SendMessageRequest,
} from "@/features/chat/components/message-request-dialog";
import { blockUser, unblockUser, reportUser, reportMessage } from "../actions";
import type { PersonProfile, PersonSearchResult } from "../types";
import {
  defaultFriendActions,
  FriendControls,
  MessagePersonButton,
  type FriendActions,
} from "./friend-controls";
import {
  BlockUserDialog,
  ReportDialog,
  type ModerationActions,
  type ModerationAction,
} from "./moderation-dialogs";
import { usePeopleMutation } from "./people-mutation";

export const defaultModerationActions: ModerationActions = {
  block: (input) => blockUser(input),
  unblock: (input) => unblockUser(input),
  reportUser: (input) => reportUser(input),
  reportMessage: (input) => reportMessage(input),
};
const defaultRequest: SendMessageRequest = (input) => sendMessageRequest(input);

export function UnblockButton({
  userId,
  action = defaultModerationActions.unblock,
}: {
  userId: string;
  action?: ModerationAction;
}) {
  const mutation = usePeopleMutation(action);
  return (
    <Button
      variant="outline"
      disabled={mutation.pending}
      onClick={() => void mutation.run({ userId }, "차단을 풀었어요")}
    >
      차단 풀기
    </Button>
  );
}

export function PersonMessageButton({
  person,
  actions,
  send = defaultRequest,
}: {
  person: Pick<
    PersonProfile,
    "userId" | "name" | "canDirectMessage" | "directRoomId"
  >;
  actions?: FriendActions;
  send?: SendMessageRequest;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (person.canDirectMessage)
    return <MessagePersonButton person={person} action={actions?.openDirect} />;
  return (
    <>
      <Button ref={trigger} variant="outline" onClick={() => setOpen(true)}>
        메시지
      </Button>
      <MessageRequestDialog
        key={person.userId}
        person={person}
        open={open}
        onOpenChange={setOpen}
        send={send}
        onReturnFocus={() => trigger.current?.focus()}
      />
    </>
  );
}

export function SearchPersonActions({
  person,
  actions,
  moderation,
  send,
  onRelation,
}: {
  person: PersonSearchResult;
  actions?: FriendActions;
  moderation?: ModerationActions;
  send?: SendMessageRequest;
  onRelation?: (relation: PersonSearchResult["relation"]) => void;
}) {
  if (person.relation === "blocked")
    return (
      <UnblockButton userId={person.userId} action={moderation?.unblock} />
    );
  return (
    <div className="flex flex-wrap gap-2">
      {person.canDirectMessage ? (
        <PersonMessageButton person={person} actions={actions} />
      ) : (
        <>
          <FriendControls
            person={person}
            relation={person.relation}
            actions={actions}
            onRelation={onRelation}
          />
          {person.relation === "none" && (
            <PersonMessageButton
              person={person}
              actions={actions}
              send={send}
            />
          )}
        </>
      )}
    </div>
  );
}

export function ProfilePersonActions({
  person,
  actions = defaultFriendActions,
  moderation = defaultModerationActions,
  send,
}: {
  person: PersonProfile;
  actions?: FriendActions;
  moderation?: ModerationActions;
  send?: SendMessageRequest;
}) {
  const [dialog, setDialog] = useState<"block" | "report" | "remove" | null>(
    null,
  );
  const trigger = useRef<HTMLButtonElement>(null);
  const remove = usePeopleMutation(actions.remove);
  const unblock = usePeopleMutation(moderation.unblock);
  const pending = remove.pending || unblock.pending;
  const restore = () => trigger.current?.focus();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {person.relation === "blocked" ? (
        <UnblockButton userId={person.userId} action={moderation.unblock} />
      ) : (
        <>
          <PersonMessageButton person={person} actions={actions} send={send} />
          <FriendControls
            person={person}
            relation={person.relation ?? "none"}
            actions={actions}
            profile
            hideMenu
          />
        </>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            variant="ghost"
            size="icon"
            aria-label={`${person.name} 더보기`}
            disabled={pending}
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (dialog) event.preventDefault();
          }}
        >
          {person.relation === "friend" && (
            <DropdownMenuItem onSelect={() => setDialog("remove")}>
              친구 끊기
            </DropdownMenuItem>
          )}
          {person.relation === "blocked" ? (
            <DropdownMenuItem
              onSelect={() =>
                void unblock.run({ userId: person.userId }, "차단을 풀었어요")
              }
            >
              차단 풀기
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onSelect={() => setDialog("block")}>
              차단
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onSelect={() => setDialog("report")}>
            신고
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <BlockUserDialog
        person={person}
        open={dialog === "block"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        action={moderation.block}
        onReturnFocus={restore}
      />
      <ReportDialog
        target={person}
        open={dialog === "report"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        report={moderation.reportUser}
        block={moderation.block}
        onReturnFocus={restore}
      />
      <Dialog
        open={dialog === "remove"}
        onOpenChange={(open) => {
          if (!open && !pending) setDialog(null);
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            restore();
          }}
        >
          <DialogHeader>
            <DialogTitle>{person.name} 님과 친구를 끊을까요?</DialogTitle>
            <DialogDescription>지금까지의 대화는 남아요</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={pending}
              onClick={() => setDialog(null)}
            >
              돌아가기
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={async () => {
                if (
                  await remove.run({ userId: person.userId }, "친구를 끊었어요")
                )
                  setDialog(null);
              }}
            >
              친구 끊기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
