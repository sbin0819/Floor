"use client";

import { useRef, type RefObject } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { FilePanel } from "./file-panel";

export function RoomFilesPanel({
  roomId,
  filesEnabled,
  wide,
  open,
  id,
  trigger,
  onOpenChange,
  onJump,
}: {
  roomId: string;
  filesEnabled: boolean;
  wide: boolean;
  open: boolean;
  id: string;
  trigger: RefObject<HTMLButtonElement | null>;
  onOpenChange: (open: boolean) => void;
  onJump: (seq: number, messageId: string) => void;
}) {
  const jumping = useRef(false);
  const close = () => {
    jumping.current = false;
    onOpenChange(false);
    if (wide) trigger.current?.focus();
  };
  const panel = (
    <FilePanel
      roomId={roomId}
      filesEnabled={filesEnabled}
      onJump={(seq, messageId) => {
        jumping.current = true;
        onOpenChange(false);
        onJump(seq, messageId);
      }}
    />
  );
  const closeButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label="파일 목록 닫기"
      onClick={close}
    >
      <X aria-hidden="true" />
    </Button>
  );
  if (wide)
    return open ? (
      <aside
        id={id}
        aria-label="파일"
        className="flex w-80 shrink-0 flex-col border-l border-border bg-card"
      >
        <div className="flex min-h-14 shrink-0 items-center justify-between border-b border-border px-4">
          <h2 className="font-bold">파일</h2>
          {closeButton}
        </div>
        {panel}
      </aside>
    ) : null;
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        jumping.current = false;
        onOpenChange(next);
      }}
    >
      <SheetContent
        id={id}
        side="bottom"
        showCloseButton={false}
        aria-describedby={undefined}
        className="flex h-[min(80dvh,48rem)] flex-col gap-0 p-0"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!jumping.current) trigger.current?.focus();
          jumping.current = false;
        }}
      >
        <SheetHeader className="flex-row items-center justify-between border-b border-border px-4 py-1">
          <SheetTitle>파일</SheetTitle>
          {closeButton}
        </SheetHeader>
        {panel}
      </SheetContent>
    </Sheet>
  );
}
