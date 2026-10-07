import { Suspense } from "react";
import { connection } from "next/server";
import {
  AuthCard,
  AuthLoading,
  type AuthPageProps,
} from "@/features/auth/components/auth-card";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";

async function ResetPasswordContent({ searchParams }: AuthPageProps) {
  await connection();
  const { token, error } = await searchParams;
  return (
    <AuthCard title="새 비밀번호를 정해 주세요">
      <ResetPasswordForm
        token={typeof token === "string" ? token : undefined}
        invalid={error !== undefined}
      />
    </AuthCard>
  );
}

export default function ResetPasswordPage(props: AuthPageProps) {
  return (
    <Suspense fallback={<AuthLoading variant="reset" />}>
      <ResetPasswordContent {...props} />
    </Suspense>
  );
}
