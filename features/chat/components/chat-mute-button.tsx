"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useRef, useState } from "react";
import { Bell, BellOff, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setRoomMuted, setSpaceMuted } from "@/features/chat/actions";
import { CHAT_NAV_KEY } from "../nav-state";
import { archiveChannel } from "@/features/chat/space-actions";
import { useSpaceMutation } from "./use-space-mutation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

export function ChatMuteButton({
  id,
  name,
  muted,
  space = false,
  manageSpaceId,
}: {
  id: string;
  name: string;
  muted: boolean;
  space?: boolean;
  manageSpaceId?: string;
}) {
  const client = useQueryClient();
  const router = useRouter();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const archive = useSpaceMutation(archiveChannel);
  const mutation = useMutation({
    scope: { id: `chat-mute:${id}` },
    retry: false,
    mutationFn: () =>
      space
        ? setSpaceMuted({ spaceId: id, muted: !muted })
        : setRoomMuted({ roomId: id, muted: !muted }),
    onSuccess(result) {
      if (result.ok) {
        void client.invalidateQueries({ queryKey: CHAT_NAV_KEY });
        router.refresh();
      } else toast.error("알림 설정을 바꾸지 못했어요.");
    },
    onError() {
      toast.error("알림 설정을 바꾸지 못했어요.");
    },
  });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={trigger}
            variant="ghost"
            size="icon"
            aria-label={`${name} 알림 설정`}
            disabled={mutation.isPending}
          >
            <MoreHorizontal aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          onCloseAutoFocus={(event) => {
            if (archiveOpen) event.preventDefault();
          }}
        >
          <DropdownMenuItem
            disabled={mutation.isPending}
            onSelect={() => mutation.mutate()}
          >
            {muted ? (
              <Bell aria-hidden="true" />
            ) : (
              <BellOff aria-hidden="true" />
            )}
            {space ? "이 스페이스 " : ""}알림 {muted ? "켜기" : "끄기"}
          </DropdownMenuItem>
          {manageSpaceId && (
            <>
              <DropdownMenuItem asChild>
                <Link
                  href={`/s/${manageSpaceId}/settings?channel=${id}`}
                  prefetch={false}
                >
                  채널 설정
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setArchiveOpen(true)}>
                보관
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {manageSpaceId && (
        <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
          <DialogContent
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              trigger.current?.focus();
            }}
          >
            <DialogHeader>
              <DialogTitle>{name} 채널을 보관할까요?</DialogTitle>
              <DialogDescription>
                기존 대화는 남지만 새 메시지를 쓸 수 없어요
              </DialogDescription>
            </DialogHeader>
            {archive.error && (
              <p role="alert" className="text-sm text-destructive">
                {archive.error}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" onClick={() => setArchiveOpen(false)}>
                돌아가기
              </Button>
              <Button
                disabled={archive.pending}
                onClick={() =>
                  void archive.submit(
                    { roomId: id },
                    () => setArchiveOpen(false),
                    "채널을 보관했어요",
                  )
                }
              >
                보관
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
