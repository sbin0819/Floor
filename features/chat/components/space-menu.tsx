"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown } from "lucide-react";
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setSpaceMuted } from "@/features/chat/actions";
import { leaveSpace } from "@/features/chat/space-actions";
import { useSpaceMutation } from "./use-space-mutation";

export function SpaceMenu({
  space,
}: {
  space: {
    id: string;
    name: string;
    kind: "team" | "branch" | "community";
    role: "member" | "admin" | "owner";
    muted: boolean;
  };
}) {
  const [confirm, setConfirm] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const leave = useSpaceMutation(leaveSpace),
    mute = useSpaceMutation(setSpaceMuted);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            variant="ghost"
            className="min-w-0 flex-1 justify-between px-0 text-base font-bold"
          >
            <span className="truncate">{space.name}</span>
            <ChevronDown className="size-4 shrink-0" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          onCloseAutoFocus={(event) => {
            if (confirm) event.preventDefault();
          }}
        >
          {space.kind === "community" && (
            <DropdownMenuItem asChild>
              <Link href={`/s/${space.id}/settings?invite=1`} prefetch={false}>
                사람 초대
              </Link>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem asChild>
            <Link href={`/s/${space.id}/settings`}>스페이스 설정</Link>
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={mute.pending}
            onSelect={() =>
              void mute.submit({ spaceId: space.id, muted: !space.muted })
            }
          >
            {space.muted ? "알림 켜기" : "알림 끄기"}
          </DropdownMenuItem>
          {space.kind !== "team" && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                disabled={space.role === "owner"}
                onSelect={() => setConfirm(true)}
              >
                {space.role === "owner"
                  ? "소유권을 넘겨야 나갈 수 있어요"
                  : "스페이스 나가기"}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {mute.error && (
        <span role="alert" className="sr-only">
          {mute.error}
        </span>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{space.name}에서 나갈까요?</DialogTitle>
            <DialogDescription>
              다시 참여하기 전에는 대화를 볼 수 없어요
            </DialogDescription>
          </DialogHeader>
          {leave.error && (
            <p role="alert" className="text-sm text-destructive">
              {leave.error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(false)}>
              돌아가기
            </Button>
            <Button
              variant="destructive"
              disabled={leave.pending}
              onClick={() =>
                void leave.submit(
                  { spaceId: space.id },
                  () => {
                    setConfirm(false);
                    router.push("/messages");
                  },
                  "스페이스에서 나갔어요",
                )
              }
            >
              나가기
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
