"use client";

import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { reactionGlyphs, reactionPeople } from "../reaction-labels";
import type { ChatReaction, ReactionEmoji } from "../types";

export function ReactionPills({
  reactions,
  disabled = false,
  onChange,
}: {
  reactions: readonly ChatReaction[];
  disabled?: boolean;
  onChange: (emoji: ReactionEmoji, on: boolean) => void;
}) {
  const visible = reactions.filter(({ count }) => count > 0);
  if (!visible.length) return null;
  return (
    <div
      role="group"
      aria-label="메시지 반응"
      className="mt-1 flex flex-wrap gap-1"
    >
      {visible.map(({ emoji, count, mine, names }) => (
        <Tooltip key={emoji}>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              disabled={disabled}
              aria-pressed={mine}
              aria-label={`${reactionGlyphs[emoji]} ${count}명${mine ? ", 나 포함. 누르면 취소" : ". 누르면 추가"}`}
              onClick={() => onChange(emoji, !mine)}
              className="h-11 rounded-full border border-border px-3 text-xs aria-pressed:border-primary aria-pressed:bg-accent aria-pressed:text-accent-foreground"
            >
              <span aria-hidden="true">{reactionGlyphs[emoji]}</span>
              <span aria-hidden="true" className="ml-1 tabular-nums">
                {count}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{reactionPeople(count, names)}</TooltipContent>
        </Tooltip>
      ))}
    </div>
  );
}
