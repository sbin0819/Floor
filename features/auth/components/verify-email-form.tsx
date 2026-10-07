"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  AuthFeedback,
  AuthField,
  authLinkClassName,
} from "@/features/auth/components/auth-fields";
import {
  SocialButtons,
  type AuthProvider,
} from "@/features/auth/components/social-buttons";
import {
  fieldErrors,
  useAuthRequest,
} from "@/features/auth/components/use-auth-request";
import { authMessages, getAuthErrorMessage } from "@/features/auth/messages";
import { emailSchema } from "@/features/auth/schema";
import { authClient } from "@/lib/auth/client";

export function VerifyEmailForm({
  email,
  emailEnabled,
  providers,
}: {
  email?: string;
  emailEnabled: boolean;
  providers: AuthProvider[];
}) {
  const request = useAuthRequest();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [remaining, setRemaining] = useState(0);
  const initialEmail = emailSchema.safeParse({ email });
  const fixedEmail = initialEmail.success ? initialEmail.data.email : undefined;

  useEffect(() => {
    if (remaining === 0) return;
    const timer = window.setTimeout(
      () => setRemaining((seconds) => Math.max(0, seconds - 1)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [remaining]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!emailEnabled || request.pending || remaining > 0) return;
    const result = emailSchema.safeParse(
      fixedEmail
        ? { email: fixedEmail }
        : Object.fromEntries(new FormData(event.currentTarget)),
    );
    setErrors(result.success ? {} : fieldErrors(result.error));
    if (!result.success) return;
    setRemaining(60);
    void request.run(async () => {
      const { error } = await authClient.sendVerificationEmail({
        email: result.data.email,
        callbackURL: "/login?verified=1",
      });
      request.setMessage(
        error ? getAuthErrorMessage(error.code) : authMessages.signupSent,
      );
    });
  }

  return (
    <div className="space-y-5">
      <AuthFeedback message={request.message} />
      {emailEnabled ? (
        <>
          <p className="text-sm text-muted-foreground">
            {fixedEmail
              ? authMessages.signupSent
              : "메일의 인증 링크를 누른 뒤 로그인해 주세요. 인증 메일이 없다면 다시 받을 수 있어요."}
          </p>
          {fixedEmail && <p className="text-sm break-all">{fixedEmail}</p>}
          <form
            noValidate
            onSubmit={submit}
            aria-busy={request.pending}
            className="space-y-4"
          >
            {!fixedEmail && (
              <AuthField
                label="이메일"
                name="email"
                type="email"
                autoComplete="email"
                required
                error={errors.email}
                disabled={request.pending}
              />
            )}
            <Button
              type="submit"
              disabled={request.pending || remaining > 0}
              className="w-full tabular-nums"
            >
              {remaining > 0
                ? `${remaining}초 뒤 다시 보낼 수 있어요`
                : "인증 메일 다시 보내기"}
            </Button>
          </form>
        </>
      ) : (
        <>
          <AuthFeedback message={authMessages.emailUnavailable} />
          <SocialButtons
            providers={providers}
            next="/"
            request={request}
            separator={false}
          />
        </>
      )}
      <Link href="/login" className={authLinkClassName}>
        로그인으로 돌아가기
      </Link>
    </div>
  );
}
