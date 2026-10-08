"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { DisplayMessage } from "./message-state";

export function MessageDeleteDialog({
  message,
  userId,
  onClose,
  onDelete,
  onReturnFocus,
}: {
  message: DisplayMessage | null;
  userId: string;
  onClose: () => void;
  onDelete: (id: string) => Promise<boolean>;
  onReturnFocus: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const remove = async () => {
    if (!message || lock.current) return;
    lock.current = true;
    setBusy(true);
    try {
      if (await onDelete(message.id)) onClose();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={message !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>메시지를 지울까요?</DialogTitle>
          <DialogDescription>
            {message && message.authorId !== userId
              ? `이 메시지는 ${message.authorName ?? "알 수 없는 사람"} 님의 메시지예요. `
              : ""}
            지운 메시지는 되돌릴 수 없어요.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onClose}>
            취소
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={() => void remove()}
          >
            {busy ? "지우고 있어요" : "지우기"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
