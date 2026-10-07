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
import {
  authMessages,
  isUnverifiedEmail,
  type AuthNotice,
} from "@/features/auth/messages";
import { loginSchema } from "@/features/auth/schema";
import { authClient } from "@/lib/auth/client";
import { safeNext } from "@/lib/auth/safe-next";

export function LoginForm({
  providers = [],
  next = "/",
  notice,
  operator = false,
}: {
  providers?: AuthProvider[];
  next?: string;
  notice?: AuthNotice;
  operator?: boolean;
}) {
  const router = useRouter();
  const request = useAuthRequest();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const destination = operator ? "/admin" : safeNext(next);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.pending) return;
    const result = loginSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    setErrors(result.success ? {} : fieldErrors(result.error));
    if (!result.success) return;
    void request.run(async () => {
      const { error } = await authClient.signIn.email(result.data);
      if (error) {
        if (isUnverifiedEmail(error.code))
          router.push(
            `/verify-email?email=${encodeURIComponent(result.data.email)}`,
          );
        else request.setMessage(authMessages.loginFailed);
        return;
      }
      router.replace(destination);
      router.refresh();
    }, authMessages.loginFailed);
  }

  return (
    <div className="space-y-5">
      <AuthFeedback notice={notice} message={request.message} />
      {!operator && (
        <SocialButtons
          providers={providers}
          next={destination}
          request={request}
        />
      )}
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
        <AuthField
          label="비밀번호"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          error={errors.password}
          disabled={request.pending}
        />
        <Button type="submit" disabled={request.pending} className="w-full">
          {request.pending ? "로그인하고 있어요…" : "로그인"}
        </Button>
      </form>
      {!operator && (
        <div className="flex flex-wrap justify-between gap-x-4">
          <Link href="/forgot-password" className={authLinkClassName}>
            비밀번호를 잊었어요
          </Link>
          <Link
            href={`/signup?next=${encodeURIComponent(destination)}`}
            className={authLinkClassName}
          >
            계정 만들기
          </Link>
        </div>
      )}
      {operator && (
        <Link href="/login" className={authLinkClassName}>
          일반 회원 로그인
        </Link>
      )}
    </div>
  );
}
