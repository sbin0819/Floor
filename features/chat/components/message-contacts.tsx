"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/actions/result";
import type { MessageContact } from "@/features/people/types";
import { openDirectMessage, createGroupDm } from "../actions";
import { ContactPicker } from "./contact-picker";

export type OpenConversation = (
  input: unknown,
) => Promise<ActionResult<{ roomId: string }>>;
export function MessageContacts({
  people,
  open = (input) => openDirectMessage(input),
  create = (input) => createGroupDm(input),
}: {
  people: MessageContact[];
  open?: OpenConversation;
  create?: OpenConversation;
}) {
  const router = useRouter();
  const id = useId();
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const locked = useRef(false);
  const active = useRef({ current: true });
  useEffect(() => {
    const scope = { current: true };
    active.current = scope;
    return () => {
      scope.current = false;
    };
  }, []);
  const mutation = useMutation({
    mutationFn: async () => {
      if (selected.length === 1) {
        const person = people.find((person) => person.userId === selected[0]);
        if (person?.directRoomId)
          return { ok: true as const, data: { roomId: person.directRoomId } };
        return open({ userId: selected[0] });
      }
      return create({ userIds: selected, name: name.trim() });
    },
    retry: false,
  });
  if (!people.length)
    return (
      <div className="space-y-3 rounded-xl border border-border bg-card p-6">
        <p className="text-sm text-muted-foreground">
          친구를 추가하거나 팀에 들어가면 메시지를 보낼 수 있어요
        </p>
        <Button asChild variant="outline">
          <Link href="/friends">친구</Link>
        </Button>
      </div>
    );
  const invalidName =
    selected.length > 1 && Array.from(name.trim()).length > 30;
  return (
    <form
      className="space-y-6"
      onSubmit={async (event) => {
        event.preventDefault();
        if (
          locked.current ||
          selected.length < 1 ||
          selected.length > 9 ||
          invalidName
        )
          return;
        locked.current = true;
        setError("");
        const scope = active.current;
        try {
          const result = await mutation.mutateAsync();
          if (!scope.current) return;
          if (result.ok) router.push(`/dm/${result.data.roomId}`);
          else
            setError(
              result.code === "FORBIDDEN"
                ? "대화를 시작할 수 없어요"
                : "대화를 열지 못했어요. 다시 시도해 주세요",
            );
        } catch {
          if (scope.current)
            setError("대화를 열지 못했어요. 다시 시도해 주세요");
        } finally {
          locked.current = false;
        }
      }}
    >
      <ContactPicker
        people={people}
        selected={selected}
        onChange={setSelected}
        max={9}
        disabled={mutation.isPending}
      />
      {selected.length > 1 && (
        <div className="space-y-2">
          <Label htmlFor={id}>그룹 이름 (선택)</Label>
          <Input
            id={id}
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={mutation.isPending}
            aria-invalid={invalidName}
            aria-describedby={invalidName ? `${id}-name-error` : undefined}
          />
          {invalidName && (
            <p
              id={`${id}-name-error`}
              role="alert"
              className="text-sm text-destructive"
            >
              이름은 30자까지 쓸 수 있어요
            </p>
          )}
        </div>
      )}
      <p className="text-sm text-muted-foreground">나를 포함해 10명까지</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        disabled={selected.length === 0 || invalidName || mutation.isPending}
      >
        {selected.length > 1
          ? `그룹 만들기 (${selected.length + 1}명)`
          : "메시지"}
      </Button>
    </form>
  );
}
