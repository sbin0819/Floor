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
  fieldErrors,
  useAuthRequest,
} from "@/features/auth/components/use-auth-request";
import {
  authMessages,
  getAuthErrorMessage,
  isInvalidReset,
} from "@/features/auth/messages";
import { resetPasswordSchema } from "@/features/auth/schema";
import { authClient } from "@/lib/auth/client";

export function ResetPasswordForm({
  token,
  invalid = false,
}: {
  token?: string;
  invalid?: boolean;
}) {
  const router = useRouter();
  const request = useAuthRequest();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rejected, setRejected] = useState(false);
  const invalidToken = !token || invalid || rejected;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (invalidToken || request.pending) return;
    const result = resetPasswordSchema.safeParse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    setErrors(result.success ? {} : fieldErrors(result.error));
    if (!result.success) return;
    void request.run(async () => {
      const { error } = await authClient.resetPassword({
        newPassword: result.data.password,
        token,
      });
      if (error) {
        if (isInvalidReset(error.code)) setRejected(true);
        else request.setMessage(getAuthErrorMessage(error.code));
        return;
      }
      router.replace("/login");
      router.refresh();
    });
  }

  return (
    <div className="space-y-5">
      {invalidToken ? (
        <>
          <AuthFeedback message={authMessages.invalidReset} />
          <Link href="/forgot-password" className={authLinkClassName}>
            재설정 메일 다시 받기
          </Link>
        </>
      ) : (
        <>
          <AuthFeedback message={request.message} />
          <form
            noValidate
            onSubmit={submit}
            aria-busy={request.pending}
            className="space-y-4"
          >
            <AuthField
              label="새 비밀번호"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              error={errors.password}
              disabled={request.pending}
            />
            <p className="text-xs text-muted-foreground">
              비밀번호는 <span className="tabular-nums">8–128</span>자로 입력해
              주세요.
            </p>
            <Button type="submit" disabled={request.pending} className="w-full">
              {request.pending
                ? "비밀번호를 바꾸고 있어요…"
                : "비밀번호 바꾸기"}
            </Button>
          </form>
        </>
      )}
      <Link href="/login" className={authLinkClassName}>
        로그인으로 돌아가기
      </Link>
    </div>
  );
}
