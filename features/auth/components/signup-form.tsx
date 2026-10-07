"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { authMessages, getAuthErrorMessage } from "@/features/auth/messages";
import { signupSchema } from "@/features/auth/schema";
import { authClient } from "@/lib/auth/client";
import { safeNext } from "@/lib/auth/safe-next";

export function SignupForm({
  providers,
  emailEnabled,
  next,
}: {
  providers: AuthProvider[];
  emailEnabled: boolean;
  next: string;
}) {
  const router = useRouter();
  const request = useAuthRequest();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const destination = safeNext(next);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!emailEnabled || request.pending) return;
    const result = signupSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    setErrors(result.success ? {} : fieldErrors(result.error));
    if (!result.success) return;
    void request.run(async () => {
      const { error } = await authClient.signUp.email({
        ...result.data,
        callbackURL: "/login?verified=1",
      });
      if (error) {
        request.setMessage(getAuthErrorMessage(error.code));
        return;
      }
      router.push(
        `/verify-email?email=${encodeURIComponent(result.data.email)}`,
      );
    });
  }

  return (
    <div className="space-y-5">
      <AuthFeedback message={request.message} />
      <SocialButtons
        providers={providers}
        next={destination}
        request={request}
        separator={emailEnabled}
      />
      {emailEnabled ? (
        <form
          noValidate
          onSubmit={submit}
          aria-busy={request.pending}
          className="space-y-4"
        >
          <AuthField
            label="이름"
            name="name"
            autoComplete="name"
            required
            error={errors.name}
            disabled={request.pending}
          />
          <AuthField
            label="이메일"
            name="email"
            type="email"
            autoComplete="email"
            required
            error={errors.email}
            disabled={request.pending}
          />
          <AuthField
            label="비밀번호"
            name="password"
            type="password"
            autoComplete="new-password"
            hint="비밀번호는 8자 이상 128자 이하로 입력해 주세요."
            required
            error={errors.password}
            disabled={request.pending}
          />
          <Button type="submit" disabled={request.pending} className="w-full">
            {request.pending ? "가입하고 있어요…" : "계정 만들기"}
          </Button>
        </form>
      ) : (
        <AuthFeedback message={authMessages.emailUnavailable} />
      )}
      <Link
        href={`/login?next=${encodeURIComponent(destination)}`}
        className={authLinkClassName}
      >
        이미 계정이 있어요. 로그인
      </Link>
    </div>
  );
}
