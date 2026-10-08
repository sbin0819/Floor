"use client";

import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Hash, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useRealtimeConnectionState } from "@/components/realtime-provider";
import type { ChannelView } from "../types";
import { ChannelMembers } from "./channel-members";
import { MessageComposer } from "./message-composer";
import { MessageList } from "./message-list";
import {
  useChannelMessages,
  type SendChatMessage,
} from "./use-channel-messages";

const wideServerSnapshot = () => true;
function useWideMembers() {
  const media = useMemo(
    () =>
      typeof window === "undefined" || !window.matchMedia
        ? null
        : window.matchMedia("(min-width: 1280px)"),
    [],
  );
  const subscribe = useCallback(
    (listener: () => void) => {
      media?.addEventListener("change", listener);
      return () => media?.removeEventListener("change", listener);
    },
    [media],
  );
  const snapshot = useCallback(() => media?.matches ?? true, [media]);
  return useSyncExternalStore(subscribe, snapshot, wideServerSnapshot);
}

export function ChannelScreen({
  data,
  send,
}: {
  data: ChannelView;
  send?: SendChatMessage;
}) {
  const messages = useChannelMessages(data, send);
  const connection = useRealtimeConnectionState();
  const [membersOpen, setMembersOpen] = useState(false);
  const wide = useWideMembers();
  const membersId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <section
      data-chat-screen
      className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col bg-background"
    >
      <header className="flex min-h-16 shrink-0 items-center gap-3 border-b border-border bg-card px-4 md:px-6">
        <Hash
          aria-hidden="true"
          className="size-5 shrink-0 text-muted-foreground"
        />
        <h1 className="truncate text-lg font-bold">{data.room.name}</h1>
        {data.room.topic && (
          <p className="hidden min-w-0 flex-1 truncate border-l border-border pl-3 text-sm text-muted-foreground sm:block">
            {data.room.topic}
          </p>
        )}
        <Button
          ref={trigger}
          type="button"
          variant="ghost"
          className="ml-auto"
          aria-label={`멤버 ${data.members.length}명`}
          aria-expanded={membersOpen}
          aria-controls={membersId}
          onClick={() => setMembersOpen((open) => !open)}
        >
          <Users aria-hidden="true" />
          <span className="tabular-nums">{data.members.length}</span>
        </Button>
      </header>
      {(connection === "disconnected" ||
        connection === "suspended" ||
        connection === "failed") && (
        <p
          role="status"
          className="shrink-0 border-b border-border bg-muted px-4 py-2 text-sm text-muted-foreground"
        >
          연결이 끊겼어요. 다시 연결하고 있어요
        </p>
      )}
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <MessageList
            channelName={data.room.name}
            now={data.now}
            userId={data.user.id}
            messages={messages.messages}
            onRetry={messages.retry}
            onRemove={messages.remove}
          />
          {data.canWrite ? (
            <MessageComposer
              key={data.room.id}
              channelName={data.room.name}
              onSend={messages.submit}
            />
          ) : (
            <p className="shrink-0 border-t border-border p-5 text-center text-sm text-muted-foreground">
              {data.room.archived
                ? "보관된 채널이에요"
                : "이 채널에는 관리자만 쓸 수 있어요"}
            </p>
          )}
        </div>
        {wide && membersOpen && (
          <aside
            id={membersId}
            aria-label="채널 멤버"
            className="w-60 shrink-0 overflow-y-auto border-l border-border bg-sidebar"
          >
            <h2 className="px-4 pt-5 text-xs font-semibold text-muted-foreground">
              멤버 · {data.members.length}
            </h2>
            <ChannelMembers members={data.members} />
          </aside>
        )}
      </div>
      <Sheet open={!wide && membersOpen} onOpenChange={setMembersOpen}>
        <SheetContent
          id={membersId}
          side="right"
          showCloseButton={false}
          aria-describedby={undefined}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            trigger.current?.focus();
          }}
        >
          <SheetHeader>
            <SheetTitle>채널 멤버</SheetTitle>
          </SheetHeader>
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2"
              aria-label="멤버 목록 닫기"
            >
              <X aria-hidden="true" />
            </Button>
          </SheetClose>
          <div className="overflow-y-auto">
            <ChannelMembers members={data.members} />
          </div>
        </SheetContent>
      </Sheet>
    </section>
  );
}
