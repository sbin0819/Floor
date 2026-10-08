"use client";

import { useId, useRef, useState, useEffect } from "react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PersonSearchResult } from "../types";
import type { FriendActions } from "./friend-controls";
import { SearchPersonActions } from "./person-actions";
import { PersonSummary } from "./person-summary";

const responseSchema = z.strictObject({
  results: z.array(
    z.strictObject({
      userId: z.uuid(),
      name: z.string(),
      username: z.string().nullable(),
      sharedTeamNames: z.array(z.string()),
      relation: z.enum(["none", "incoming", "outgoing", "friend", "blocked"]),
      directRoomId: z.uuid().nullable(),
      canDirectMessage: z.boolean(),
    }),
  ),
});
export class PeopleSearchError extends Error {
  constructor(public readonly status: number) {
    super("People search failed");
  }
}
export type SearchPeople = (
  query: string,
  signal: AbortSignal,
) => Promise<PersonSearchResult[]>;
export const searchPeople: SearchPeople = async (query, signal) => {
  const response = await fetch(
    `/api/people/search?${new URLSearchParams({ q: query })}`,
    { signal, cache: "no-store" },
  );
  if (!response.ok) throw new PeopleSearchError(response.status);
  return responseSchema.parse(await response.json()).results;
};

export function PeopleSearch({
  actions,
  search = searchPeople,
}: {
  actions?: FriendActions;
  search?: SearchPeople;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PersonSearchResult[] | null>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      request.current?.abort();
      request.current = null;
    },
    [],
  );
  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-card"
    >
      <h2 id={`${id}-heading`} className="font-semibold">
        친구 추가
      </h2>
      <form
        className="space-y-2"
        onSubmit={async (event) => {
          event.preventDefault();
          if (request.current) return;
          const input = query.trim();
          if (!input || input.length > 254) {
            setError("사용자 이름이나 이메일을 정확히 입력해 주세요");
            return;
          }
          const controller = new AbortController();
          request.current = controller;
          setPending(true);
          setError("");
          setResults(null);
          try {
            const found = await search(input, controller.signal);
            if (!controller.signal.aborted && request.current === controller)
              setResults(found);
          } catch (cause) {
            if (!controller.signal.aborted && request.current === controller)
              setError(
                cause instanceof PeopleSearchError && cause.status === 429
                  ? "찾기를 너무 많이 했어요. 잠시 뒤에 다시 해 주세요"
                  : "찾지 못했어요. 잠시 뒤에 다시 해 주세요",
              );
          } finally {
            if (request.current === controller) {
              request.current = null;
              setPending(false);
            } else if (controller.signal.aborted && !request.current)
              setPending(false);
          }
        }}
      >
        <Label htmlFor={id}>사용자 이름이나 이메일</Label>
        <div className="flex gap-2">
          <Input
            id={id}
            value={query}
            maxLength={254}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="사용자 이름이나 이메일을 정확히 입력하세요"
            autoComplete="off"
            disabled={pending}
            aria-describedby={error ? `${id}-error` : undefined}
          />
          <Button type="submit" disabled={pending}>
            {pending ? "찾는 중…" : "찾기"}
          </Button>
        </div>
      </form>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {pending && (
        <p role="status" className="text-sm text-muted-foreground">
          사람을 찾고 있어요
        </p>
      )}
      {results?.length === 0 && (
        <p role="status" className="text-sm text-muted-foreground">
          찾는 사람이 없어요. 사용자 이름이나 이메일이 정확한지 확인해 주세요
        </p>
      )}
      {results && results.length > 0 && (
        <ul aria-label="찾은 사람" className="divide-y divide-border">
          {results.map((person) => (
            <li
              key={person.userId}
              className="flex flex-wrap items-center gap-3 py-3"
            >
              <PersonSummary person={person} />
              <SearchPersonActions
                person={person}
                actions={actions}
                onRelation={(relation) =>
                  setResults(
                    (rows) =>
                      rows?.map((row) =>
                        row.userId === person.userId
                          ? { ...row, relation }
                          : row,
                      ) ?? null,
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
