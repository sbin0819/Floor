"use client";

import { useId, useRef, useState } from "react";
import Image from "next/image";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  Archive,
  File,
  FileText,
  ImageIcon,
  MessageSquare,
  Presentation,
  Sheet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { errorMessage } from "@/lib/errors/messages";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  fetchRoomFiles,
  roomFilesKey,
  type ReadRoomFiles,
} from "../file-client";
import { fileIconKind, formatFileSize } from "../file-format";
import type { RoomFile, RoomFilesKind } from "../file-types";
import { AttachmentGallery } from "./message-attachments";

const icons = {
  archive: Archive,
  document: FileText,
  presentation: Presentation,
  spreadsheet: Sheet,
  file: File,
};
const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
});
const fileUrlDefault = (id: string, download = false) =>
  `/api/files/${id}${download ? "?download=1" : ""}`;

type FilePanelProps = {
  roomId: string;
  filesEnabled: boolean;
  onJump: (seq: number, messageId: string) => void;
  readFiles?: ReadRoomFiles;
  fileUrl?: (id: string, download?: boolean) => string;
};

export function FilePanel(props: FilePanelProps) {
  return <FilePanelContent key={props.roomId} {...props} />;
}

function FilePanelContent({
  roomId,
  filesEnabled,
  onJump,
  readFiles = fetchRoomFiles,
  fileUrl = fileUrlDefault,
}: FilePanelProps) {
  const [kind, setKind] = useState<RoomFilesKind>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const id = useId();
  const query = useInfiniteQuery({
    queryKey: [...roomFilesKey(roomId), kind],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) =>
      readFiles(roomId, {
        kind,
        ...(pageParam ? { before: pageParam } : {}),
        signal,
      }),
    getNextPageParam: (page) => (page.hasMore ? page.nextCursor : undefined),
    retry: false,
    staleTime: 0,
  });
  const seen = new Set<string>();
  const files =
    query.data?.pages
      .flatMap((page) => page.files)
      .filter((file) => {
        if (seen.has(file.id)) return false;
        seen.add(file.id);
        return true;
      }) ?? [];
  const selected = files.find((file) => file.id === selectedId);
  const images = files
    .filter(
      (file) => file.kind === "image" && file.messageId === selected?.messageId,
    )
    .reverse();
  const selectedIndex = images.findIndex((file) => file.id === selectedId);

  return (
    <section
      aria-label="공유한 파일"
      className="flex min-h-0 flex-1 flex-col"
      data-file-panel
    >
      <div className="shrink-0 border-b border-border px-4">
        <RadioGroup
          aria-label="파일 종류"
          value={kind}
          onValueChange={(value) => {
            if (value === "all" || value === "image" || value === "file") {
              setKind(value);
              setSelectedId(null);
            }
          }}
          className="flex gap-4"
        >
          {(
            [
              ["all", "전체"],
              ["image", "이미지"],
              ["file", "파일"],
            ] as const
          ).map(([value, label]) => (
            <Label
              key={value}
              htmlFor={`${id}-${value}`}
              className="flex min-h-11 cursor-pointer items-center gap-2 text-sm"
            >
              <RadioGroupItem id={`${id}-${value}`} value={value} />
              {label}
            </Label>
          ))}
        </RadioGroup>
      </div>
      <div
        className="min-h-0 flex-1 overflow-y-auto p-4"
        aria-busy={query.isPending || query.isFetchingNextPage}
      >
        {query.isPending ? (
          <div className="space-y-4">
            <span role="status" className="sr-only">
              파일을 불러오고 있어요
            </span>
            {[0, 1, 2].map((row) => (
              <div key={row} className="flex gap-3" aria-hidden>
                <Skeleton className="size-14 shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              </div>
            ))}
          </div>
        ) : query.isError && !query.data ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-muted-foreground">
              {errorMessage(query.error, "파일을 불러오지 못했어요.")}
            </p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              다시 불러오기
            </Button>
          </div>
        ) : files.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            아직 올라온 파일이 없어요
          </p>
        ) : (
          <ul className="space-y-3">
            {files.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                enabled={filesEnabled}
                fileUrl={fileUrl}
                onJump={onJump}
                onOpen={(element) => {
                  trigger.current = element;
                  setSelectedId(file.id);
                }}
              />
            ))}
          </ul>
        )}
        {query.isFetchNextPageError && (
          <p role="alert" className="mt-4 text-sm text-muted-foreground">
            {errorMessage(
              query.error,
              "다음 파일을 불러오지 못했어요. 다시 시도해 주세요.",
            )}
          </p>
        )}
        {query.hasNextPage && (
          <Button
            variant="outline"
            className="mt-4 w-full"
            disabled={query.isFetchingNextPage}
            onClick={() => void query.fetchNextPage()}
          >
            {query.isFetchingNextPage ? "불러오는 중이에요" : "더 보기"}
          </Button>
        )}
      </div>
      {filesEnabled && (
        <AttachmentGallery
          images={images}
          index={selectedIndex >= 0 ? selectedIndex : null}
          onIndexChange={(index) => setSelectedId(images[index]?.id ?? null)}
          onClose={() => setSelectedId(null)}
          onReturnFocus={() => {
            if (trigger.current?.isConnected) trigger.current.focus();
          }}
          fileUrl={fileUrl}
        />
      )}
    </section>
  );
}

function FileRow({
  file,
  enabled,
  onOpen,
  onJump,
  fileUrl,
}: {
  file: RoomFile;
  enabled: boolean;
  onOpen: (element: HTMLButtonElement) => void;
  onJump: FilePanelProps["onJump"];
  fileUrl: NonNullable<FilePanelProps["fileUrl"]>;
}) {
  const Icon =
    file.kind === "image" ? ImageIcon : icons[fileIconKind(file.name)];
  const details = (
    <>
      {file.kind === "image" && enabled ? (
        <Image
          unoptimized
          src={fileUrl(file.id)}
          alt={file.name}
          width={56}
          height={56}
          loading="lazy"
          className="size-14 shrink-0 rounded-md object-cover"
        />
      ) : (
        <span className="flex size-14 shrink-0 items-center justify-center rounded-md bg-muted">
          <Icon aria-hidden className="size-6 text-muted-foreground" />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{file.name}</span>
        <span className="mt-1 block truncate text-xs text-muted-foreground">
          {file.uploaderName} ·{" "}
          <time dateTime={file.sentAt} className="tabular-nums">
            {dateFormatter.format(Date.parse(file.sentAt))}
          </time>{" "}
          · <span className="tabular-nums">{formatFileSize(file.size)}</span>
        </span>
        {!enabled && (
          <span className="mt-1 block text-xs text-muted-foreground">
            지금은 받을 수 없어요
          </span>
        )}
      </span>
    </>
  );
  const className =
    "flex w-full min-w-0 items-center gap-3 rounded-lg p-3 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <li className="rounded-lg border border-border bg-card">
      <Tooltip>
        <TooltipTrigger asChild>
          {enabled ? (
            file.kind === "image" ? (
              <button
                type="button"
                className={className}
                aria-label={`${file.name} 크게 보기`}
                onClick={(event) => onOpen(event.currentTarget)}
              >
                {details}
              </button>
            ) : (
              <a
                href={fileUrl(file.id, true)}
                download
                className={className}
                aria-label={`${file.name} 내려받기`}
              >
                {details}
              </a>
            )
          ) : (
            <div className={className} tabIndex={0}>
              {details}
            </div>
          )}
        </TooltipTrigger>
        <TooltipContent>{file.name}</TooltipContent>
      </Tooltip>
      <div className="flex justify-end px-2 pb-1">
        <Button
          variant="ghost"
          className="text-xs text-muted-foreground"
          aria-label={`${file.name} 메시지로 가기`}
          onClick={() => onJump(file.seq, file.messageId)}
        >
          <MessageSquare aria-hidden />
          메시지로 가기
        </Button>
      </div>
    </li>
  );
}
