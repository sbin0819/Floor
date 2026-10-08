"use client";

import Image from "next/image";
import { File, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { UploadItem } from "../upload-controller";
import { formatFileSize } from "../file-format";

export function AttachmentStrip({
  items,
  onRemove,
  onRetry,
}: {
  items: readonly UploadItem[];
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  if (!items.length) return null;
  return (
    <ul
      aria-label="보낼 첨부 파일"
      className="mb-2 flex gap-2 overflow-x-auto pb-1"
    >
      {items.map((item) => (
        <li
          key={item.id}
          className="relative w-52 shrink-0 rounded-lg border border-border bg-card p-3"
        >
          <div className="flex min-w-0 items-center gap-2 pr-6">
            {item.previewUrl ? (
              <Image
                unoptimized
                src={item.previewUrl}
                alt={item.name}
                width={40}
                height={40}
                className="size-10 shrink-0 rounded-sm object-cover"
              />
            ) : (
              <File
                aria-hidden
                className="size-8 shrink-0 text-muted-foreground"
              />
            )}
            <div className="min-w-0">
              <p className="truncate text-sm" title={item.name}>
                {item.name}
              </p>
              <span className="text-xs text-muted-foreground tabular-nums">
                {formatFileSize(item.size)}
              </span>
            </div>
          </div>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="absolute top-0 right-0"
            aria-label={`${item.name} 빼기`}
            onClick={() => onRemove(item.id)}
          >
            <X aria-hidden />
          </Button>
          {item.status === "failed" ? (
            <>
              <p role="alert" className="mt-1 text-xs text-destructive">
                {item.error}
              </p>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onRetry(item.id)}
              >
                <RotateCcw aria-hidden />
                다시 올리기
              </Button>
            </>
          ) : item.status === "ready" ? (
            <p className="mt-2 text-xs text-muted-foreground">올림 완료</p>
          ) : (
            <div
              className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-label={`${item.name} 올리는 중`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={item.progress}
            >
              <div
                className="h-full bg-primary transition-[width] motion-reduce:transition-none"
                style={{ width: `${item.progress}%` }}
              />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}
