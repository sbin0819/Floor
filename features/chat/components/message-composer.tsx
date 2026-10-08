"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { messageBodySchema } from "../schema";
import {
  toMessageBody,
  type MentionCandidate,
  type MentionInputValue,
} from "../mention-input";
import { MentionTextarea } from "./mention-textarea";
import type { ChatReply } from "../types";

const noMembers: readonly MentionCandidate[] = [];

export function MessageComposer({
  channelName,
  onSend,
  members = noMembers,
  allowEveryone = false,
  reply = null,
  onClearReply,
  onEditLast,
  onInput,
  focusVersion = 0,
  placeholder,
}: {
  channelName: string;
  onSend: (body: string, reply?: ChatReply) => void;
  members?: readonly MentionCandidate[];
  allowEveryone?: boolean;
  reply?: ChatReply | null;
  onClearReply?: () => void;
  onEditLast?: () => void;
  onInput?: (body: string) => void;
  focusVersion?: number;
  placeholder?: string;
}) {
  const [value, setValue] = useState<MentionInputValue>({
    text: "",
    mentions: [],
  });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (focusVersion > 0) inputRef.current?.focus();
  }, [focusVersion]);
  const body = toMessageBody(value);
  const descriptionId = useId();
  const count = Array.from(body.trim()).length;
  const valid = messageBodySchema.safeParse(body).success;
  const submit = () => {
    const input = messageBodySchema.safeParse(body);
    if (!input.success) return;
    if (reply) onSend(input.data, reply);
    else onSend(input.data);
    setValue({ text: "", mentions: [] });
    onClearReply?.();
    onInput?.("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "ArrowUp" && !value.text && onEditLast) {
      event.preventDefault();
      onEditLast();
      return;
    }
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229
    )
      return;
    event.preventDefault();
    submit();
  };
  return (
    <form
      aria-label="메시지 보내기"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="shrink-0 border-t border-border bg-background px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-6"
    >
      {reply && (
        <div className="mb-2 flex items-center gap-2 rounded-md border-l-2 border-border bg-muted px-3 text-sm">
          <div className="min-w-0 flex-1">
            <strong>{reply.authorName ?? "알 수 없는 사람"}에게 답장</strong>
            <p className="truncate text-xs text-muted-foreground">
              {reply.deleted ? "삭제된 메시지예요" : reply.excerpt}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="답장 취소"
            onClick={onClearReply}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
      )}
      <div className="flex items-end gap-2 rounded-xl border border-input bg-card p-2 shadow-card">
        <MentionTextarea
          inputRef={inputRef}
          aria-label="메시지"
          aria-describedby={count > 3500 ? descriptionId : undefined}
          aria-invalid={count > 4000 || undefined}
          placeholder={placeholder ?? `#${channelName}에 메시지 보내기`}
          value={value}
          onChange={(next) => {
            setValue(next);
            onInput?.(next.text);
          }}
          members={members}
          allowEveryone={allowEveryone}
          onKeyDown={onKeyDown}
          rows={1}
          className="max-h-54 min-h-11 resize-none overflow-y-auto border-0 py-3 leading-6 shadow-none"
        />
        <Button type="submit" aria-label="보내기" size="icon" disabled={!valid}>
          <Send aria-hidden="true" />
        </Button>
      </div>
      {count > 3500 && (
        <p
          id={descriptionId}
          className="mt-1 text-right text-xs text-muted-foreground tabular-nums"
        >
          {count > 4000
            ? `${count - 4000}자 줄여 주세요`
            : `${4000 - count}자 남았어요`}
        </p>
      )}
    </form>
  );
}
