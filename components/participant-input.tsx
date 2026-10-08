"use client";

import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { useQuery } from "@tanstack/react-query";
import { X } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  MAX_GUEST_PARTICIPANTS,
  MAX_PARTICIPANTS,
  participantQuerySchema,
  type BookingParticipantDraft,
  type ParticipantSearchResult,
} from "@/features/bookings/participants";
import {
  fetchParticipants,
  ParticipantSearchError,
  type SearchParticipants,
} from "@/features/bookings/participant-search-client";

export function ParticipantInput({
  value,
  onChange,
  maxParticipants = MAX_PARTICIPANTS,
  disabled = false,
  error,
  inputRef: suppliedRef,
  id: suppliedId,
  search = fetchParticipants,
  defaultQuery = "",
}: {
  value: readonly BookingParticipantDraft[];
  onChange: (value: BookingParticipantDraft[]) => void;
  maxParticipants?: number;
  disabled?: boolean;
  error?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  id?: string;
  search?: SearchParticipants;
  defaultQuery?: string;
}) {
  const generatedId = useId();
  const id = suppliedId ?? generatedId;
  const localRef = useRef<HTMLInputElement>(null);
  const inputRef = suppliedRef ?? localRef;
  const [input, setInput] = useState({ value: defaultQuery, revision: 0 });
  const [settledRevision, setSettledRevision] = useState(-1);
  const queryRef = useRef(defaultQuery);
  const [open, setOpen] = useState(Boolean(defaultQuery));
  const [activeIndex, setActiveIndex] = useState(-1);
  const [announcement, setAnnouncement] = useState("");
  const valid = participantQuerySchema.safeParse(input.value).success;
  const full =
    value.length >= Math.max(0, Math.min(maxParticipants, MAX_PARTICIPANTS));
  const guests = value.filter(
    (person) => person.sharedTeamNames.length === 0,
  ).length;
  useEffect(() => {
    const timer = setTimeout(() => setSettledRevision(input.revision), 250);
    return () => clearTimeout(timer);
  }, [input.revision]);
  const results = useQuery({
    // 검색어에는 전체 이메일이 들어갈 수 있어 캐시 키에는 입력별 순번만 둔다.
    queryKey: ["participant-search", generatedId, input.revision],
    queryFn: ({ signal }) =>
      search(participantQuerySchema.parse(queryRef.current), signal),
    enabled:
      open && valid && !disabled && !full && settledRevision === input.revision,
    gcTime: 0,
    staleTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const visible = open && valid && !disabled && !full;
  const current = settledRevision === input.revision;
  const options = visible && current ? (results.data ?? []) : [];
  const busy = visible && (!current || results.isPending || results.isFetching);
  const listId = `${id}-results`;
  const active = options[activeIndex];
  const updateQuery = (text: string) => {
    queryRef.current = text;
    setInput((previous) => ({ value: text, revision: previous.revision + 1 }));
    setActiveIndex(-1);
  };
  const unavailable = (person: ParticipantSearchResult) =>
    value.some((chosen) => chosen.userId === person.userId)
      ? "넣었어요"
      : person.sharedTeamNames.length === 0 && guests >= MAX_GUEST_PARTICIPANTS
        ? "손님은 5명까지예요"
        : null;
  const add = (person: ParticipantSearchResult) => {
    if (!visible || !current || busy || unavailable(person)) return;
    const found = participantQuerySchema.safeParse(queryRef.current);
    if (!found.success) return;
    onChange([
      ...value,
      {
        ...person,
        ...(person.sharedTeamNames.length === 0 ? { email: found.data } : {}),
      },
    ]);
    setAnnouncement(`${person.name} 님을 넣었어요`);
    updateQuery("");
    setOpen(false);
    inputRef.current?.focus();
  };
  const remove = (person: BookingParticipantDraft) => {
    if (disabled) return;
    onChange(value.filter((chosen) => chosen.userId !== person.userId));
    setAnnouncement(`${person.name} 님을 뺐어요`);
  };
  const failure =
    results.error instanceof ParticipantSearchError &&
    results.error.status === 429
      ? "잠시 뒤 다시 찾아 주세요"
      : results.error instanceof ParticipantSearchError &&
          results.error.status === 401
        ? "로그인이 필요해요. 다시 로그인해 주세요"
        : "사람을 찾지 못했어요. 잠시 뒤 다시 찾아 주세요";
  return (
    <div className="min-w-0 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label htmlFor={id}>참석자 (선택)</Label>
        {value.length > 0 && (
          <span className="text-xs text-muted-foreground tabular-nums">
            나 포함 {value.length + 1}명
          </span>
        )}
      </div>
      {value.length > 0 && (
        <ul aria-label="넣은 참석자" className="flex flex-wrap gap-1.5">
          {value.map((person) => (
            <li
              key={person.userId}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-muted pl-2 text-sm"
            >
              <UserAvatar name={person.name} avatar={person.avatar} size={20} />
              <span>{person.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                disabled={disabled}
                aria-label={`${person.name} 빼기`}
                onClick={() => remove(person)}
              >
                <X aria-hidden="true" className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      <Input
        ref={inputRef}
        id={id}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={visible}
        aria-controls={visible ? listId : undefined}
        aria-activedescendant={
          visible && active ? `${id}-option-${activeIndex}` : undefined
        }
        aria-invalid={Boolean(error)}
        aria-describedby={[
          `${id}-hint`,
          error ? `${id}-error` : null,
          full ? `${id}-full` : null,
        ]
          .filter(Boolean)
          .join(" ")}
        autoComplete="off"
        placeholder="이름이나 이메일로 찾기"
        value={input.value}
        disabled={disabled || full}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          updateQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape" && visible) {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            setActiveIndex(-1);
          } else if (
            (event.key === "ArrowDown" || event.key === "ArrowUp") &&
            options.length > 0
          ) {
            event.preventDefault();
            setActiveIndex((index) =>
              event.key === "ArrowDown"
                ? (index + 1) % options.length
                : (index <= 0 ? options.length : index) - 1,
            );
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (active) add(active);
          } else if (
            event.key === "Backspace" &&
            input.value === "" &&
            value.length > 0
          ) {
            event.preventDefault();
            remove(value[value.length - 1]!);
          }
        }}
      />
      {visible && (
        <div
          id={listId}
          role="listbox"
          aria-label="참석자 검색 결과"
          aria-busy={busy}
          className="max-h-60 overflow-y-auto rounded-lg border border-border bg-popover p-1"
        >
          {busy ? (
            <p role="status" className="p-3 text-sm text-muted-foreground">
              찾고 있어요
            </p>
          ) : results.error ? (
            <p role="status" className="p-3 text-sm text-muted-foreground">
              {failure}
            </p>
          ) : options.length === 0 ? (
            <p role="status" className="p-3 text-sm text-muted-foreground">
              찾는 사람이 없어요
            </p>
          ) : (
            options.map((person, index) => {
              const reason = unavailable(person);
              return (
                <button
                  type="button"
                  role="option"
                  id={`${id}-option-${index}`}
                  key={person.userId}
                  aria-selected={activeIndex === index}
                  aria-disabled={Boolean(reason)}
                  tabIndex={-1}
                  className={cn(
                    "flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm focus-visible:outline-2 focus-visible:outline-ring",
                    activeIndex === index && "bg-accent",
                    reason && "text-muted-foreground",
                  )}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => add(person)}
                >
                  <UserAvatar
                    name={person.name}
                    avatar={person.avatar}
                    size={32}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">{person.name}</span>
                    <span className="block text-xs break-words text-muted-foreground">
                      {[...person.sharedTeamNames, person.maskedEmail].join(
                        " · ",
                      )}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs">{reason ?? "추가"}</span>
                </button>
              );
            })
          )}
        </div>
      )}
      {full && (
        <p id={`${id}-full`} className="text-xs text-muted-foreground">
          정원이 찼어요
        </p>
      )}
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        같은 팀이 아닌 사람은 이메일 전체를 적으면 찾을 수 있어요
      </p>
      {error && (
        <p id={`${id}-error`} className="text-xs text-destructive">
          {error}
        </p>
      )}
      <span aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </span>
    </div>
  );
}
