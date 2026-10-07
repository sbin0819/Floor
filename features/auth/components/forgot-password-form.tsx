"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
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
import { authMessages } from "@/features/auth/messages";
import { emailSchema } from "@/features/auth/schema";
import { authClient } from "@/lib/auth/client";

export function ForgotPasswordForm({
  emailEnabled,
  providers,
}: {
  emailEnabled: boolean;
  providers: AuthProvider[];
}) {
  const request = useAuthRequest();
  const [errors, setErrors] = useState<Record<string, string>>({});

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!emailEnabled || request.pending) return;
    const result = emailSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    setErrors(result.success ? {} : fieldErrors(result.error));
    if (!result.success) return;
    void request.run(async () => {
      // 응답이나 네트워크 실패로 계정 유무를 추측할 수 없게 같은 안내를 보여준다.
      await authClient
        .requestPasswordReset({
          email: result.data.email,
          redirectTo: "/reset-password",
        })
        .catch(() => undefined);
      request.setMessage(authMessages.resetSent);
    }, authMessages.resetSent);
  }

  return (
    <div className="space-y-5">
      <AuthFeedback message={request.message} />
      {emailEnabled ? (
        <form
          noValidate
          onSubmit={submit}
          aria-busy={request.pending}
          className="space-y-4"
        >
          <AuthField
            label="이메일"
            name="email"
            type="email"
            autoComplete="email"
            required
            error={errors.email}
            disabled={request.pending}
          />
          <Button type="submit" disabled={request.pending} className="w-full">
            {request.pending ? "메일을 요청하고 있어요…" : "재설정 메일 보내기"}
          </Button>
        </form>
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
