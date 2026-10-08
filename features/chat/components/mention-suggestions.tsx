"use client";

import type { MentionCandidate } from "../mention-input";

export function MentionSuggestions({
  id,
  candidates,
  activeIndex,
  onChoose,
}: {
  id: string;
  candidates: readonly MentionCandidate[];
  activeIndex: number;
  onChoose: (candidate: MentionCandidate) => void;
}) {
  return (
    <div
      id={id}
      role="listbox"
      aria-label="멘션할 사람"
      className="absolute inset-x-0 bottom-full z-10 mb-1 max-h-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 shadow-pop"
    >
      {candidates.map((candidate, index) => (
        <button
          key={candidate.userId}
          id={`${id}-${index}`}
          type="button"
          role="option"
          tabIndex={-1}
          aria-selected={activeIndex === index}
          className={`flex min-h-11 w-full items-center rounded-md px-3 text-left text-sm ${activeIndex === index ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onChoose(candidate)}
        >
          @{candidate.name}
        </button>
      ))}
    </div>
  );
}
