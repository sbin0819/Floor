"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  fromMessageBody,
  toMessageBody,
  type MentionCandidate,
} from "../mention-input";
import type { MentionNames } from "../message-text";
import { messageBodySchema } from "../schema";
import { MentionTextarea } from "./mention-textarea";

export function MessageEditor({
  messageId,
  body,
  names,
  members,
  allowEveryone,
  onSave,
  onCancel,
}: {
  messageId: string;
  body: string;
  names: MentionNames;
  members: readonly MentionCandidate[];
  allowEveryone: boolean;
  onSave: (id: string, body: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(() =>
    fromMessageBody(body, names, allowEveryone),
  );
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    input.current?.focus();
    return () => {
      active.current = false;
    };
  }, []);
  const save = async () => {
    const result = messageBodySchema.safeParse(toMessageBody(value));
    if (!result.success || locked.current) return;
    locked.current = true;
    setBusy(true);
    try {
      if ((await onSave(messageId, result.data)) && active.current) onCancel();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  };
  return (
    <form
      aria-label="메시지 수정"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
      className="space-y-2"
    >
      <MentionTextarea
        inputRef={input}
        aria-label="메시지 수정"
        value={value}
        onChange={setValue}
        members={members}
        allowEveryone={allowEveryone}
        disabled={busy}
        rows={2}
        onKeyDown={(event) => {
          if (event.key === "Escape" && !busy) {
            event.preventDefault();
            onCancel();
          } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            void save();
          }
        }}
      />
      <div className="flex gap-2">
        <Button
          type="submit"
          disabled={
            busy || !messageBodySchema.safeParse(toMessageBody(value)).success
          }
        >
          {busy ? "저장하고 있어요" : "저장"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={busy}
          onClick={onCancel}
        >
          취소
        </Button>
      </div>
    </form>
  );
}
