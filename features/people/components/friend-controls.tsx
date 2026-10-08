"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
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
import type { ActionResult } from "@/lib/actions/result";
import { openDirectMessage } from "@/features/chat/actions";
import {
  sendFriendRequest,
  respondFriendRequest,
  cancelFriendRequest,
  removeFriend,
} from "../actions";
import type { FriendRow, PersonRelation } from "../types";
import { peopleError, usePeopleMutation } from "./people-mutation";

export type FriendActions = {
  send: (input: unknown) => Promise<ActionResult<{ relation: PersonRelation }>>;
  respond: (input: unknown) => Promise<ActionResult<unknown>>;
  cancel: (input: unknown) => Promise<ActionResult<unknown>>;
  remove: (input: unknown) => Promise<ActionResult<unknown>>;
  openDirect: (input: unknown) => Promise<ActionResult<{ roomId: string }>>;
};
export const defaultFriendActions: FriendActions = {
  send: (input) => sendFriendRequest(input),
  respond: (input) => respondFriendRequest(input),
  cancel: (input) => cancelFriendRequest(input),
  remove: (input) => removeFriend(input),
  openDirect: (input) => openDirectMessage(input),
};

export function MessagePersonButton({
  person,
  action = openDirectMessage,
  disabled = false,
}: {
  person: Pick<FriendRow, "userId" | "directRoomId">;
  action?: FriendActions["openDirect"];
  disabled?: boolean;
}) {
  const router = useRouter();
  const mutation = usePeopleMutation(action, undefined, (result) =>
    result.code === "FORBIDDEN"
      ? "메시지를 보낼 수 없어요"
      : peopleError(result),
  );
  if (person.directRoomId)
    return (
      <Button asChild variant="outline">
        <Link href={`/dm/${person.directRoomId}`}>메시지</Link>
      </Button>
    );
  return (
    <Button
      variant="outline"
      disabled={disabled || mutation.pending}
      onClick={async () => {
        const result = await mutation.run({ userId: person.userId }, "");
        if (result) router.push(`/dm/${result.data.roomId}`);
      }}
    >
      메시지
    </Button>
  );
}

export function FriendControls({
  person,
  relation,
  actions = defaultFriendActions,
  list = false,
  profile = false,
  hideMenu = false,
  onRelation,
}: {
  person: Pick<FriendRow, "userId" | "name" | "directRoomId">;
  relation: PersonRelation;
  actions?: FriendActions;
  list?: boolean;
  profile?: boolean;
  hideMenu?: boolean;
  onRelation?: (relation: PersonRelation) => void;
}) {
  const locked = useRef(false);
  const send = usePeopleMutation(actions.send, locked);
  const respond = usePeopleMutation(actions.respond, locked);
  const cancel = usePeopleMutation(actions.cancel, locked);
  const remove = usePeopleMutation(actions.remove, locked);
  const pending =
    send.pending || respond.pending || cancel.pending || remove.pending;
  const [confirm, setConfirm] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  if (relation === "none")
    return (
      <Button
        disabled={pending}
        onClick={async () => {
          const result = await send.run({ userId: person.userId }, (data) =>
            data.relation === "friend"
              ? "이제 친구예요"
              : "친구 요청을 보냈어요",
          );
          if (result) onRelation?.(result.data.relation);
        }}
      >
        {profile ? "친구 추가" : "친구 요청"}
      </Button>
    );
  if (relation === "outgoing")
    return list ? (
      <Button
        variant="outline"
        disabled={pending}
        onClick={() =>
          void cancel.run({ userId: person.userId }, "요청을 취소했어요")
        }
      >
        취소
      </Button>
    ) : (
      <Button variant="outline" disabled>
        요청 보냄
      </Button>
    );
  if (relation === "incoming")
    return (
      <div className="flex gap-2">
        <Button
          disabled={pending}
          onClick={async () => {
            const result = await respond.run(
              { userId: person.userId, accept: true },
              "이제 친구예요",
            );
            if (result) onRelation?.("friend");
          }}
        >
          {profile ? "요청 수락" : "수락"}
        </Button>
        {list && (
          <Button
            variant="outline"
            disabled={pending}
            onClick={() =>
              void respond.run(
                { userId: person.userId, accept: false },
                "요청을 거절했어요",
              )
            }
          >
            거절
          </Button>
        )}
      </div>
    );
  return (
    <div className="flex items-center gap-2">
      {!profile && (
        <MessagePersonButton
          person={person}
          action={actions.openDirect}
          disabled={pending}
        />
      )}
      {(list || profile) && !hideMenu && (
        <>
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
                if (confirm) event.preventDefault();
              }}
            >
              <DropdownMenuItem
                className="text-destructive"
                onSelect={() => setConfirm(true)}
              >
                친구 끊기
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Dialog
            open={confirm}
            onOpenChange={(open) => {
              if (!pending) setConfirm(open);
            }}
          >
            <DialogContent
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                trigger.current?.focus();
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
                  onClick={() => setConfirm(false)}
                >
                  돌아가기
                </Button>
                <Button
                  variant="destructive"
                  disabled={pending}
                  onClick={async () => {
                    const result = await remove.run(
                      { userId: person.userId },
                      "친구를 끊었어요",
                    );
                    if (result) {
                      setConfirm(false);
                      onRelation?.("none");
                    }
                  }}
                >
                  친구 끊기
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  );
}
