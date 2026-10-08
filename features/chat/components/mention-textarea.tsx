"use client";

import {
  useId,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Textarea } from "@/components/ui/textarea";
import {
  chooseMention,
  filterMentionCandidates,
  findMentionQuery,
  updateMentionInput,
  type MentionCandidate,
  type MentionInputValue,
} from "../mention-input";
import { MentionSuggestions } from "./mention-suggestions";

export function MentionTextarea({
  value,
  onChange,
  members,
  allowEveryone = false,
  inputRef,
  onKeyDown,
  ...props
}: Omit<
  ComponentProps<typeof Textarea>,
  "value" | "onChange" | "onKeyDown" | "ref"
> & {
  value: MentionInputValue;
  onChange: (value: MentionInputValue) => void;
  members: readonly MentionCandidate[];
  allowEveryone?: boolean;
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  onKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}) {
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? ownRef;
  const id = useId();
  const [caret, setCaret] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const query = findMentionQuery(value, caret);
  const candidates =
    query && dismissed !== `${value.text}:${caret}` && !props.disabled
      ? filterMentionCandidates(members, query.query, allowEveryone)
      : [];
  const index = Math.min(activeIndex, candidates.length - 1);
  const choose = (candidate: MentionCandidate) => {
    if (!query) return;
    const next = chooseMention(value, query, candidate);
    onChange(next.value);
    setCaret(next.caret);
    setDismissed(null);
    requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(next.caret, next.caret);
    });
  };
  return (
    <div className="relative min-w-0 flex-1">
      {candidates.length > 0 && (
        <MentionSuggestions
          id={id}
          candidates={candidates}
          activeIndex={index}
          onChoose={choose}
        />
      )}
      <Textarea
        {...props}
        ref={ref}
        role="combobox"
        aria-autocomplete="list"
        aria-haspopup="listbox"
        aria-expanded={candidates.length > 0}
        aria-controls={candidates.length ? id : undefined}
        aria-activedescendant={index >= 0 ? `${id}-${index}` : undefined}
        value={value.text}
        onChange={(event) => {
          onChange(updateMentionInput(value, event.target.value));
          setCaret(event.target.selectionStart);
          setActiveIndex(0);
          setDismissed(null);
        }}
        onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
        onKeyDown={(event) => {
          if (
            event.nativeEvent.isComposing ||
            event.nativeEvent.keyCode === 229
          )
            return;
          if (candidates.length) {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex(
                (index +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  candidates.length) %
                  candidates.length,
              );
              return;
            }
            if (event.key === "Enter" || event.key === "Tab") {
              event.preventDefault();
              choose(candidates[index]!);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              setDismissed(`${value.text}:${caret}`);
              return;
            }
          }
          onKeyDown?.(event);
        }}
      />
    </div>
  );
}
