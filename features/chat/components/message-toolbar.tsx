"use client";

import { useRef, useState, type ReactNode } from "react";
import {
  Copy,
  Ellipsis,
  Flag,
  Pencil,
  Reply,
  SmilePlus,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { reactionGlyphs, reactionNames } from "../reaction-labels";
import {
  reactionEmojis,
  type ChatReaction,
  type ReactionEmoji,
} from "../types";

export type MessageToolbarProps = {
  canReact: boolean;
  canReply: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canReport?: boolean;
  canCopy?: boolean;
  reactions?: readonly ChatReaction[];
  disabled?: boolean;
  onReaction: (emoji: ReactionEmoji, on: boolean) => void;
  onReply: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReport?: () => void;
  onCopy?: () => void;
  onEscape?: () => void;
};

function ActionButton({
  label,
  disabled,
  pressed,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={label}
          aria-pressed={pressed}
          disabled={disabled}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ReactionChoices({
  reactions = [],
  disabled,
  onReaction,
}: Pick<MessageToolbarProps, "reactions" | "disabled" | "onReaction">) {
  return (
    <div
      role="group"
      aria-label="리액션 고르기"
      className="grid grid-cols-4 gap-1"
    >
      {reactionEmojis.map((emoji) => {
        const mine = reactions.some(
          (reaction) => reaction.emoji === emoji && reaction.mine,
        );
        return (
          <ActionButton
            key={emoji}
            label={`${reactionGlyphs[emoji]} ${reactionNames[emoji]} ${mine ? "취소" : "추가"}`}
            pressed={mine}
            disabled={disabled}
            onClick={() => onReaction(emoji, !mine)}
          >
            <span aria-hidden="true" className="text-lg">
              {reactionGlyphs[emoji]}
            </span>
          </ActionButton>
        );
      })}
    </div>
  );
}

export function MessageToolbar(props: MessageToolbarProps) {
  const [choosing, setChoosing] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const actionSelected = useRef(false);
  if (
    !props.canReact &&
    !props.canReply &&
    !props.canEdit &&
    !props.canDelete &&
    !props.canReport &&
    !props.canCopy
  )
    return null;
  return (
    <div
      role="toolbar"
      aria-label="메시지 도구"
      className="flex w-fit items-center rounded-lg border border-border bg-popover p-1 shadow-pop"
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.defaultPrevented &&
          !choosing &&
          !moreOpen
        )
          props.onEscape?.();
      }}
    >
      {props.canReact && (
        <>
          {(["thumbs_up", "heart", "tada"] as const).map((emoji) => {
            const mine =
              props.reactions?.some(
                (reaction) => reaction.emoji === emoji && reaction.mine,
              ) ?? false;
            return (
              <ActionButton
                key={emoji}
                label={`${reactionGlyphs[emoji]} ${reactionNames[emoji]} ${mine ? "취소" : "추가"}`}
                pressed={mine}
                disabled={props.disabled}
                onClick={() => props.onReaction(emoji, !mine)}
              >
                <span aria-hidden="true">{reactionGlyphs[emoji]}</span>
              </ActionButton>
            );
          })}
          <Popover open={choosing} onOpenChange={setChoosing}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="리액션 고르기"
                disabled={props.disabled}
              >
                <SmilePlus aria-hidden="true" />
              </Button>
            </PopoverTrigger>
            <PopoverContent aria-label="리액션" className="w-fit">
              <ReactionChoices
                reactions={props.reactions}
                disabled={props.disabled}
                onReaction={(emoji, on) => {
                  setChoosing(false);
                  props.onReaction(emoji, on);
                }}
              />
            </PopoverContent>
          </Popover>
        </>
      )}
      {props.canReply && (
        <ActionButton
          label="답장"
          disabled={props.disabled}
          onClick={props.onReply}
        >
          <Reply aria-hidden="true" />
        </ActionButton>
      )}
      {props.canEdit && (
        <ActionButton
          label="수정"
          disabled={props.disabled}
          onClick={props.onEdit}
        >
          <Pencil aria-hidden="true" />
        </ActionButton>
      )}
      {(props.canCopy || props.canDelete || props.canReport) && (
        <DropdownMenu open={moreOpen} onOpenChange={setMoreOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="메시지 더보기"
              disabled={props.disabled}
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              // 삭제 확인을 여는 쪽이 포커스를 정한다. 메뉴가 새 대화상자의 포커스를 빼앗지 않는다.
              if (actionSelected.current) {
                event.preventDefault();
                actionSelected.current = false;
              }
            }}
          >
            {props.canCopy && (
              <DropdownMenuItem
                className="min-h-11"
                onSelect={() => props.onCopy?.()}
              >
                <Copy aria-hidden="true" />
                본문 복사
              </DropdownMenuItem>
            )}
            {props.canDelete && (
              <DropdownMenuItem
                variant="destructive"
                className="min-h-11"
                onSelect={() => {
                  actionSelected.current = true;
                  props.onDelete();
                }}
              >
                <Trash2 aria-hidden="true" />
                삭제
              </DropdownMenuItem>
            )}
            {props.canReport && (
              <DropdownMenuItem
                className="min-h-11"
                onSelect={() => {
                  actionSelected.current = true;
                  props.onReport?.();
                }}
              >
                <Flag aria-hidden="true" />
                신고
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export function MessageActionsSheet({
  open,
  onOpenChange,
  onReturnFocus,
  ...props
}: MessageToolbarProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onReturnFocus?: () => void;
}) {
  const actionSelected = useRef(false);
  function choose(action: () => void, movesFocus = false) {
    actionSelected.current = movesFocus;
    onOpenChange(false);
    action();
  }
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="max-h-[85dvh] overflow-y-auto rounded-t-xl pb-[max(1rem,env(safe-area-inset-bottom))]"
        onCloseAutoFocus={(event) => {
          if (actionSelected.current) {
            event.preventDefault();
            actionSelected.current = false;
          } else if (onReturnFocus) {
            event.preventDefault();
            onReturnFocus();
          }
        }}
      >
        <SheetHeader>
          <SheetTitle>메시지 동작</SheetTitle>
          <SheetDescription>메시지에 할 동작을 골라 주세요.</SheetDescription>
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="메시지 동작 닫기"
              className="absolute top-3 right-3"
            >
              <X aria-hidden="true" />
            </Button>
          </SheetClose>
        </SheetHeader>
        <div className="space-y-2 px-4">
          {props.canReact && (
            <ReactionChoices
              reactions={props.reactions}
              disabled={props.disabled}
              onReaction={(emoji, on) =>
                choose(() => props.onReaction(emoji, on))
              }
            />
          )}
          {props.canReply && (
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              disabled={props.disabled}
              onClick={() => choose(props.onReply, true)}
            >
              <Reply aria-hidden="true" />
              답장
            </Button>
          )}
          {props.canEdit && (
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              disabled={props.disabled}
              onClick={() => choose(props.onEdit, true)}
            >
              <Pencil aria-hidden="true" />
              수정
            </Button>
          )}
          {props.canCopy && (
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              disabled={props.disabled}
              onClick={() => choose(() => props.onCopy?.())}
            >
              <Copy aria-hidden="true" />
              본문 복사
            </Button>
          )}
          {props.canDelete && (
            <Button
              type="button"
              variant="destructive"
              className="w-full justify-start"
              disabled={props.disabled}
              onClick={() => choose(props.onDelete, true)}
            >
              <Trash2 aria-hidden="true" />
              삭제
            </Button>
          )}
          {props.canReport && (
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              disabled={props.disabled}
              onClick={() => choose(() => props.onReport?.(), true)}
            >
              <Flag aria-hidden="true" />
              신고
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
