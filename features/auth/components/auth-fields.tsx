"use client";

import Link from "next/link";
import { useId, type ComponentProps } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AuthNotice } from "@/features/auth/messages";

export const authLinkClassName =
  "inline-flex min-h-11 items-center rounded-lg text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";

export function AuthField({
  label,
  error,
  ...props
}: ComponentProps<typeof Input> & { label: string; error?: string }) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        {...props}
        id={id}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        className="h-11"
      />
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
