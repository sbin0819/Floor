"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MessageContact } from "@/features/people/types";

export function ContactPicker({
  people,
  selected,
  onChange,
  max,
  existing = [],
  disabled = false,
}: {
  people: readonly MessageContact[];
  selected: readonly string[];
  onChange: (ids: string[]) => void;
  max: number;
  existing?: readonly string[];
  disabled?: boolean;
}) {
  const id = useId();
  const [query, setQuery] = useState("");
  const needle = query.trim().normalize("NFC").toLowerCase();
  const visible = people.filter(
    (person) =>
      person.name.normalize("NFC").toLowerCase().includes(needle) ||
      person.username?.includes(needle),
  );
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor={id}>이름으로 거르기</Label>
        <Input
          id={id}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="이름 또는 사용자 이름"
        />
      </div>
      {visible.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          이름이 맞는 사람이 없어요
        </p>
      ) : (
        ([true, false] as const).map((friends) => {
          const rows = visible.filter((person) => person.isFriend === friends);
          if (!rows.length) return null;
          const title = friends ? "친구" : "같은 팀";
          return (
            <section key={title} aria-label={title} className="space-y-2">
              <h2 className="text-sm font-semibold">{title}</h2>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {rows.map((person) => {
                  const checked = selected.includes(person.userId);
                  const present = existing.includes(person.userId);
                  return (
                    <li key={person.userId}>
                      <label className="flex min-h-11 cursor-pointer items-center gap-3 p-4 hover:bg-muted has-disabled:cursor-default has-disabled:opacity-60">
                        <input
                          type="checkbox"
                          checked={checked || present}
                          disabled={
                            disabled ||
                            present ||
                            (!checked && selected.length >= max)
                          }
                          onChange={() =>
                            onChange(
                              checked
                                ? selected.filter(
                                    (value) => value !== person.userId,
                                  )
                                : [...selected, person.userId],
                            )
                          }
                          aria-label={`${person.name} 선택${present ? " (참여 중)" : ""}`}
                          className="size-4 shrink-0 accent-primary"
                        />
                        <span
                          aria-hidden="true"
                          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-semibold"
                        >
                          {Array.from(person.name.trim())[0] ?? "?"}
                        </span>
                        <span className="min-w-0 text-left">
                          <span className="block truncate font-semibold">
                            {person.name}
                          </span>
                          {person.username && (
                            <span className="block text-xs text-muted-foreground">
                              @{person.username}
                            </span>
                          )}
                          {person.sharedTeamNames.length > 0 && (
                            <span className="block text-xs text-muted-foreground">
                              {person.sharedTeamNames.join(" · ")}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
