"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { MessageContact } from "@/features/people/types";
import { openDirectMessage } from "../actions";

export function MessageContacts({
  people,
  open = openDirectMessage,
}: {
  people: MessageContact[];
  open?: typeof openDirectMessage;
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
    <div className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor={id}>이름으로 거르기</Label>
        <Input
          id={id}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="이름 또는 사용자 이름"
        />
      </div>
      {people.length === 0 ? (
        <div className="space-y-3 rounded-xl border border-border bg-card p-6">
          <p className="text-sm text-muted-foreground">
            친구를 추가하거나 팀에 들어가면 메시지를 보낼 수 있어요
          </p>
          <Button asChild variant="outline">
            <Link href="/friends">친구</Link>
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          이름이 맞는 사람이 없어요
        </p>
      ) : (
        ([true, false] as const).map((friends) => {
          const rows = visible.filter((person) => person.isFriend === friends);
          if (!rows.length) return null;
          const title = friends ? "친구" : "같은 팀";
          return (
            <section key={title} aria-label={title} className="space-y-3">
              <h2 className="text-sm font-semibold">{title}</h2>
              <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
                {rows.map((person) => (
                  <ContactRow key={person.userId} person={person} open={open} />
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}

function ContactRow({
  person,
  open,
}: {
  person: MessageContact;
  open: typeof openDirectMessage;
}) {
  const router = useRouter();
  const locked = useRef(false);
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const mutation = useMutation({
    mutationFn: () => open({ userId: person.userId }),
    retry: false,
  });
  const content = (
    <>
      <span
        aria-hidden="true"
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-semibold"
      >
        {Array.from(person.name.trim())[0] ?? "?"}
      </span>
      <span className="min-w-0 text-left">
        <span className="block truncate font-semibold">{person.name}</span>
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
    </>
  );
  const className =
    "flex min-h-11 w-full items-center gap-3 p-4 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring";
  return (
    <li>
      {person.directRoomId ? (
        <Link className={className} href={`/dm/${person.directRoomId}`}>
          {content}
        </Link>
      ) : (
        <button
          type="button"
          className={className}
          disabled={mutation.isPending}
          onClick={async () => {
            if (locked.current) return;
            locked.current = true;
            try {
              const result = await mutation.mutateAsync();
              if (!active.current) return;
              if (result.ok) router.push(`/dm/${result.data.roomId}`);
              else
                toast.error(
                  result.code === "FORBIDDEN"
                    ? "친구가 되면 메시지를 보낼 수 있어요"
                    : "대화를 열지 못했어요. 다시 시도해 주세요",
                );
            } catch {
              if (active.current)
                toast.error("대화를 열지 못했어요. 다시 시도해 주세요");
            } finally {
              locked.current = false;
            }
          }}
        >
          {content}
        </button>
      )}
    </li>
  );
}
