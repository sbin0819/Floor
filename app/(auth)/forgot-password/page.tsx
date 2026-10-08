import { Suspense } from "react";
import { connection } from "next/server";
import {
  AuthCard,
  AuthFormSkeleton,
} from "@/features/auth/components/auth-card";
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";
import { MemberAuthFrame } from "@/features/auth/components/member-auth-frame";
import { getAuthUiOptions } from "@/lib/auth/auth";

async function ForgotPasswordContent() {
  await connection();
  return <ForgotPasswordForm {...getAuthUiOptions()} />;
}

export default function ForgotPasswordPage() {
  return (
    <MemberAuthFrame>
      <AuthCard
        title="비밀번호를 잊었나요?"
        description="이메일로 비밀번호를 다시 정할 수 있어요."
      >
        <Suspense fallback={<AuthFormSkeleton variant="email" />}>
          <ForgotPasswordContent />
        </Suspense>
      </AuthCard>
    </MemberAuthFrame>
  );
}
