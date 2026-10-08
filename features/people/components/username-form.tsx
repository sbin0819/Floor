"use client";

import { useId, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ActionResult } from "@/lib/actions/result";
import { parseUsername } from "@/lib/people/username";
import { setUsername } from "@/features/people/actions";
import type { UsernameSettings } from "../types";

export type SaveUsername = (
  input: unknown,
) => Promise<ActionResult<{ username: string }>>;
const invalidMessage = "영문 소문자, 숫자, `.`, `_`로 3–20자";

export function UsernameForm({
  settings,
  action = setUsername,
  onSaved,
}: {
  settings: UsernameSettings;
  action?: SaveUsername;
  onSaved?: (username: string) => void;
}) {
  const id = useId();
  const router = useRouter();
  const [value, setValue] = useState(
    settings.username ?? settings.suggestion ?? "",
  );
  const [error, setError] = useState("");
  const locked = useRef(false);
  const mutation = useMutation({
    mutationFn: (input: unknown) => action(input),
    retry: false,
  });
  const nextChange = settings.nextChangeAt;
  const hint = nextChange
    ? `${new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" }).format(Date.parse(nextChange))}부터 다시 바꿀 수 있어요`
    : "사용자 이름은 30일에 한 번 바꿀 수 있어요";
  return (
    <form
      className="space-y-2"
      onSubmit={async (event) => {
        event.preventDefault();
        if (locked.current || nextChange) return;
        const username = parseUsername(value);
        if (!username) {
          setError(invalidMessage);
          return;
        }
        locked.current = true;
        setError("");
        try {
          const result = await mutation.mutateAsync({ username });
          if (!result.ok) {
            setError(
              result.code === "USERNAME_TAKEN"
                ? "이미 쓰고 있는 이름이에요"
                : result.message === "username_cooldown"
                  ? "아직 바꿀 수 없어요"
                  : result.code === "INVALID_INPUT"
                    ? invalidMessage
                    : "저장하지 못했어요. 다시 시도해 주세요",
            );
            return;
          }
          setValue(result.data.username);
          toast.success("사용자 이름을 저장했어요");
          onSaved?.(result.data.username);
          router.refresh();
        } catch {
          setError("저장하지 못했어요. 다시 시도해 주세요");
        } finally {
          locked.current = false;
        }
      }}
    >
      <Label htmlFor={id}>사용자 이름</Label>
      <div className="flex items-start gap-2">
        <div className="relative min-w-0 flex-1">
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-3 left-3 text-sm text-muted-foreground"
          >
            @
          </span>
          <Input
            id={id}
            className="pl-8"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError("");
            }}
            disabled={Boolean(nextChange) || mutation.isPending}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={Boolean(error)}
            aria-describedby={`${id}-hint${error ? ` ${id}-error` : ""}`}
          />
        </div>
        <Button
          type="submit"
          disabled={Boolean(nextChange) || mutation.isPending}
        >
          {mutation.isPending ? "저장 중…" : "저장"}
        </Button>
      </div>
      <p id={`${id}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </p>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </form>
  );
}
