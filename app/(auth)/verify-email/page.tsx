import { Suspense } from "react";
import { connection } from "next/server";
import {
  AuthCard,
  AuthFormSkeleton,
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
    <VerifyEmailForm
      {...getAuthUiOptions()}
      development={getEnv().NODE_ENV !== "production"}
      email={typeof email === "string" ? email : undefined}
    />
  );
}

export default function VerifyEmailPage(props: AuthPageProps) {
  return (
    <MemberAuthFrame>
      <AuthCard title="메일을 확인해 주세요">
        <Suspense fallback={<AuthFormSkeleton variant="email" />}>
          <VerifyEmailContent {...props} />
        </Suspense>
      </AuthCard>
    </MemberAuthFrame>
  );
}
