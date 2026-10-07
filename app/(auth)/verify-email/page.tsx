import { Suspense } from "react";
import { connection } from "next/server";
import {
  AuthCard,
  AuthLoading,
  type AuthPageProps,
} from "@/features/auth/components/auth-card";
import { VerifyEmailForm } from "@/features/auth/components/verify-email-form";
import { MemberAuthFrame } from "@/features/auth/components/member-auth-frame";
import { getAuthUiOptions } from "@/lib/auth/auth";
import { getEnv } from "@/lib/env";

async function VerifyEmailContent({ searchParams }: AuthPageProps) {
  await connection();
  const { email } = await searchParams;
  return (
    <AuthCard title="메일을 확인해 주세요">
      <VerifyEmailForm
        {...getAuthUiOptions()}
        development={getEnv().NODE_ENV !== "production"}
        email={typeof email === "string" ? email : undefined}
      />
    </AuthCard>
  );
}

export default function VerifyEmailPage(props: AuthPageProps) {
  return (
    <MemberAuthFrame>
      <Suspense fallback={<AuthLoading variant="email" />}>
        <VerifyEmailContent {...props} />
      </Suspense>
    </MemberAuthFrame>
  );
}
