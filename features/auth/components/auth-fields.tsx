"use client";

import Link from "next/link";
import { useId, useState, type ComponentProps } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthNotice } from "@/features/auth/messages";

export const authLinkClassName =
  "inline-flex min-h-11 items-center rounded-lg text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";

export function AuthField({
  label,
  error,
  hint,
  type,
  ...props
}: ComponentProps<typeof Input> & {
  label: string;
  error?: string;
  hint?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const [visible, setVisible] = useState(false);
  const password = type === "password";
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Input
          {...props}
          type={password && visible ? "text" : type}
          id={id}
          aria-invalid={!!error}
          aria-describedby={
            [error && errorId, hint && `${id}-hint`]
              .filter(Boolean)
              .join(" ") || undefined
          }
          className={`h-11 ${password ? "pr-12" : ""}`}
        />
        {password && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute inset-y-0 right-0 text-muted-foreground"
            disabled={props.disabled}
            aria-label={visible ? "비밀번호 숨기기" : "비밀번호 보기"}
            aria-controls={id}
            onClick={() => setVisible((value) => !value)}
          >
            {visible ? (
              <EyeOff aria-hidden="true" />
            ) : (
              <Eye aria-hidden="true" />
            )}
          </Button>
        )}
      </div>
      {hint && (
        <p
          id={`${id}-hint`}
          className="text-xs text-muted-foreground tabular-nums"
        >
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} className="text-xs text-muted-foreground">
          {error}
        </p>
      )}
    </div>
  );
}

export function AuthFeedback({
  notice,
  message,
}: {
  notice?: AuthNotice;
  message?: string;
}) {
  const text = message || notice?.message;
  return (
    <div aria-live="polite" aria-atomic="true">
      {text && (
        <Alert className="border-border bg-muted text-foreground">
          <AlertDescription className="text-foreground">
            <p>{text}</p>
            {!message && notice?.href && (
              <Link href={notice.href} className={authLinkClassName}>
                {notice.linkLabel}
              </Link>
            )}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
