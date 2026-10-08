"use client";

import { useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Download,
  File,
  FileText,
  Presentation,
  Sheet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import type { ChatAttachment } from "../types";
import { fileIconKind, formatFileSize } from "../file-format";

const icons = {
  archive: Archive,
  document: FileText,
  presentation: Presentation,
  spreadsheet: Sheet,
  file: File,
};
export type AttachmentUrl = (id: string, download?: boolean) => string;
export const attachmentUrl: AttachmentUrl = (id, download) =>
  `/api/files/${id}${download ? "?download=1" : ""}`;
export function FileCard({
  attachment,
  enabled = true,
  fileUrl = attachmentUrl,
}: {
  attachment: ChatAttachment;
  enabled?: boolean;
  fileUrl?: AttachmentUrl;
}) {
  const Icon = icons[fileIconKind(attachment.name)];
  return (
    <div className="flex w-90 max-w-full min-w-0 items-center gap-3 rounded-lg border border-border bg-card p-3">
      <Icon aria-hidden className="size-8 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                tabIndex={0}
                className="block truncate text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring"
              >
                {attachment.name}
              </span>
            </TooltipTrigger>
            <TooltipContent>{attachment.name}</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatFileSize(attachment.size)}
        </p>
        {!enabled && (
          <p className="text-xs text-muted-foreground">지금은 받을 수 없어요</p>
        )}
      </div>
      {enabled && (
        <Button asChild variant="ghost" size="icon">
          <a
            href={fileUrl(attachment.id, true)}
            download
            aria-label={`${attachment.name} 내려받기`}
          >
            <Download aria-hidden />
          </a>
        </Button>
      )}
    </div>
  );
}

export function AttachmentGallery({
  images,
  index,
  onIndexChange,
  onClose,
  onReturnFocus,
  fileUrl = attachmentUrl,
}: {
  images: readonly ChatAttachment[];
  index: number | null;
  onIndexChange: (index: number) => void;
  onClose: () => void;
  onReturnFocus?: () => void;
  fileUrl?: AttachmentUrl;
}) {
  const selected = index === null ? undefined : images[index];
  const move = (direction: number) => {
    if (index !== null)
      onIndexChange((index + direction + images.length) % images.length);
  };
  return (
    <Dialog
      open={!!selected}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[95dvh] flex-col sm:max-w-5xl"
        onCloseAutoFocus={
          onReturnFocus
            ? (event) => {
                event.preventDefault();
                onReturnFocus();
              }
            : undefined
        }
        onKeyDown={(event) => {
          if (images.length < 2) return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            move(event.key === "ArrowLeft" ? -1 : 1);
          }
        }}
      >
        {selected && (
          <>
            <DialogTitle className="pr-10 break-all">
              {selected.name}
            </DialogTitle>
            <DialogDescription className="tabular-nums">
              {formatFileSize(selected.size)} · {(index ?? 0) + 1}/
              {images.length}
            </DialogDescription>
            <div className="relative min-h-0 flex-1 overflow-auto">
              <Image
                unoptimized
                src={fileUrl(selected.id)}
                alt={selected.name}
                width={selected.width ?? 1}
                height={selected.height ?? 1}
                className="mx-auto max-h-[70dvh] w-auto max-w-full object-contain"
              />
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex gap-2">
                {images.length > 1 && (
                  <>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="이전 이미지"
                      onClick={() => move(-1)}
                    >
                      <ChevronLeft aria-hidden />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      aria-label="다음 이미지"
                      onClick={() => move(1)}
                    >
                      <ChevronRight aria-hidden />
                    </Button>
                  </>
                )}
              </div>
              <Button asChild variant="outline">
                <a href={fileUrl(selected.id, true)} download>
                  <Download aria-hidden />
                  내려받기
                </a>
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function MessageAttachments({
  attachments,
  enabled = true,
  fileUrl = attachmentUrl,
  align = "start",
  trailing,
  highlighted = false,
}: {
  attachments: readonly ChatAttachment[];
  enabled?: boolean;
  fileUrl?: AttachmentUrl;
  align?: "start" | "end";
  trailing?: ReactNode;
  highlighted?: boolean;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  if (!attachments.length) return null;
  const images = attachments.filter((file) => file.kind === "image");
  const files = attachments.filter((file) => file.kind !== "image");
  return (
    <div
      className={`mt-2 flex max-w-full min-w-0 items-end gap-2 ${align === "end" ? "flex-row-reverse" : ""}`}
      data-message-attachments
    >
      <div
        data-message-attachment-cards
        data-message-bubble-anchor
        className={`relative flex max-w-[min(560px,75cqw)] min-w-0 flex-col gap-2 rounded-lg @max-[600px]:max-w-[80cqw] ${align === "end" ? "items-end" : "items-start"} ${highlighted ? "ring-2 ring-ring/40" : ""}`}
      >
        {enabled && images.length > 0 ? (
          <div
            className={
              images.length > 1
                ? "grid w-87 max-w-full grid-cols-2 gap-2"
                : "max-w-full"
            }
          >
            {images.map((file, index) => (
              <button
                key={file.id}
                type="button"
                aria-label={`${file.name} 크게 보기`}
                className={`relative block overflow-hidden rounded-lg bg-muted focus-visible:outline-2 focus-visible:outline-ring ${images.length > 1 ? "aspect-square w-42.5 max-w-full min-w-0" : "max-h-90 max-w-full"}`}
                style={
                  images.length > 1
                    ? undefined
                    : {
                        aspectRatio: `${file.width ?? 1}/${file.height ?? 1}`,
                        width: Math.min(file.width ?? 360, 360),
                        maxHeight: 360,
                      }
                }
                onClick={(event) => {
                  trigger.current = event.currentTarget;
                  setSelected(index);
                }}
              >
                <Image
                  unoptimized
                  fill
                  loading="lazy"
                  sizes={
                    images.length > 1
                      ? "170px"
                      : "(max-width: 480px) 80vw, 360px"
                  }
                  src={fileUrl(file.id)}
                  alt={file.name}
                  className="object-cover"
                />
              </button>
            ))}
          </div>
        ) : (
          images.map((file) => (
            <FileCard
              key={file.id}
              attachment={file}
              enabled={false}
              fileUrl={fileUrl}
            />
          ))
        )}
        {files.map((file) => (
          <FileCard
            key={file.id}
            attachment={file}
            enabled={enabled}
            fileUrl={fileUrl}
          />
        ))}
      </div>
      {trailing}
      {enabled && (
        <AttachmentGallery
          fileUrl={fileUrl}
          images={images}
          index={selected}
          onIndexChange={setSelected}
          onClose={() => setSelected(null)}
          onReturnFocus={() => trigger.current?.focus()}
        />
      )}
    </div>
  );
}
