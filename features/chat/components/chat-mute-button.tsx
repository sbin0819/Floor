"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Bell, BellOff, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { setRoomMuted, setSpaceMuted } from "../actions";
import { CHAT_NAV_KEY } from "../nav-state";

export function ChatMuteButton({
  id,
  name,
  muted,
  space = false,
}: {
  id: string;
  name: string;
  muted: boolean;
  space?: boolean;
}) {
  const client = useQueryClient();
  const router = useRouter();
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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`${name} 알림 설정`}
          disabled={mutation.isPending}
        >
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={mutation.isPending}
          onSelect={() => mutation.mutate()}
        >
          {muted ? <Bell aria-hidden="true" /> : <BellOff aria-hidden="true" />}
          {space ? "이 스페이스 " : ""}알림 {muted ? "켜기" : "끄기"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
