"use client";

import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent,
} from "react";
import { Plus, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { optionalMessageBodySchema } from "../schema";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";
import { AttachmentStrip } from "./attachment-strip";
import {
  uploadErrors,
  type UploadController,
  type UploadItem,
} from "../upload-controller";
import {
  toMessageBody,
  type MentionCandidate,
  type MentionInputValue,
} from "../mention-input";
import { MentionTextarea } from "./mention-textarea";
import type { ChatAttachment, ChatReply } from "../types";

const noMembers: readonly MentionCandidate[] = [];
const noUploads: UploadItem[] = [];
const noUploadSnapshot = () => noUploads;
const noSubscription = () => () => {};

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
  uploads,
  uploadUnavailable = uploadErrors.disabled,
}: {
  channelName: string;
  onSend: (
    body: string,
    reply?: ChatReply,
    attachments?: ChatAttachment[],
  ) => void;
  members?: readonly MentionCandidate[];
  allowEveryone?: boolean;
  reply?: ChatReply | null;
  onClearReply?: () => void;
  onEditLast?: () => void;
  onInput?: (body: string) => void;
  focusVersion?: number;
  placeholder?: string;
  uploads?: UploadController;
  uploadUnavailable?: string | null;
}) {
  const items = useSyncExternalStore(
    uploads?.subscribe ?? noSubscription,
    uploads?.getSnapshot ?? noUploadSnapshot,
    noUploadSnapshot,
  );
  const fileInput = useRef<HTMLInputElement>(null);
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
  const hasPending = items.some((item) => item.status !== "ready");
  const uploading = items.some(
    (item) => !["ready", "failed"].includes(item.status),
  );
  const valid =
    optionalMessageBodySchema.safeParse(body).success &&
    (!!body.trim() || items.length > 0) &&
    !hasPending;
  const submit = () => {
    const input = optionalMessageBodySchema.safeParse(body);
    if (!input.success || !valid) return;
    const attachments = uploads?.take() ?? [];
    if (attachments.length) onSend(input.data, reply ?? undefined, attachments);
    else if (reply) onSend(input.data, reply);
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
      {uploads && (
        <AttachmentStrip
          items={items}
          onRemove={uploads.remove}
          onRetry={uploads.retry}
        />
      )}
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
        <input
          ref={fileInput}
          type="file"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-label="첨부 파일 선택"
          disabled={!!uploadUnavailable}
          onChange={(event) => {
            uploads?.add(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={!!uploadUnavailable}
                  aria-label={uploadUnavailable ?? "파일 올리기"}
                  onClick={() => fileInput.current?.click()}
                >
                  <Plus aria-hidden />
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {uploadUnavailable ?? "파일 올리기"}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files).filter((file) =>
              file.type.startsWith("image/"),
            );
            if (files.length) {
              event.preventDefault();
              uploads?.add(files);
            }
          }}
          rows={1}
          className="max-h-54 min-h-11 resize-none overflow-y-auto border-0 py-3 leading-6 shadow-none"
        />
        <Button
          type="submit"
          aria-label={uploading ? "올리는 중…" : "보내기"}
          size="icon"
          disabled={!valid}
        >
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
