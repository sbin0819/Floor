"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { messageBodySchema } from "../schema";

export function MessageComposer({
  channelName,
  onSend,
}: {
  channelName: string;
  onSend: (body: string) => void;
}) {
  const [body, setBody] = useState("");
  const descriptionId = useId();
  const count = Array.from(body.trim()).length;
  const valid = messageBodySchema.safeParse(body).success;
  const submit = () => {
    const input = messageBodySchema.safeParse(body);
    if (!input.success) return;
    onSend(input.data);
    setBody("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
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
      <div className="flex items-end gap-2 rounded-xl border border-input bg-card p-2 shadow-card">
        <Textarea
          aria-label="메시지"
          aria-describedby={count > 3500 ? descriptionId : undefined}
          aria-invalid={count > 4000 || undefined}
          placeholder={`#${channelName}에 메시지 보내기`}
          value={body}
          onChange={(event) => setBody(event.target.value)}
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
