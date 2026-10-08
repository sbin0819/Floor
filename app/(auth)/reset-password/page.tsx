import { Suspense } from "react";
import { connection } from "next/server";
import {
  AuthCard,
  AuthFormSkeleton,
  type AuthPageProps,
} from "@/features/auth/components/auth-card";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";
import { MemberAuthFrame } from "@/features/auth/components/member-auth-frame";

async function ResetPasswordContent({ searchParams }: AuthPageProps) {
  await connection();
  const { token, error } = await searchParams;
  return (
    <ResetPasswordForm
      token={typeof token === "string" ? token : undefined}
      invalid={error !== undefined}
    />
  );
}

export default function ResetPasswordPage(props: AuthPageProps) {
  return (
    <MemberAuthFrame>
      <AuthCard title="새 비밀번호를 정해 주세요">
        <Suspense fallback={<AuthFormSkeleton variant="reset" />}>
          <ResetPasswordContent {...props} />
        </Suspense>
      </AuthCard>
    </MemberAuthFrame>
  );
}
