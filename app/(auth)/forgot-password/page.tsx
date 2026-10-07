import { Suspense } from "react";
import { connection } from "next/server";
import { AuthCard, AuthLoading } from "@/features/auth/components/auth-card";
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";
import { getAuthUiOptions } from "@/lib/auth/auth";

async function ForgotPasswordContent() {
  await connection();
  return (
    <AuthCard
      title="비밀번호를 잊었나요?"
      description="이메일로 비밀번호를 다시 정할 수 있어요."
    >
      <ForgotPasswordForm {...getAuthUiOptions()} />
    </AuthCard>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<AuthLoading />}>
      <ForgotPasswordContent />
    </Suspense>
  );
}
