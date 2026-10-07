import { Suspense } from "react";
import { connection } from "next/server";
import {
  AuthCard,
  AuthLoading,
  type AuthPageProps,
} from "@/features/auth/components/auth-card";
import { VerifyEmailForm } from "@/features/auth/components/verify-email-form";
import { getAuthUiOptions } from "@/lib/auth/auth";

async function VerifyEmailContent({ searchParams }: AuthPageProps) {
  await connection();
  const { email } = await searchParams;
  return (
    <AuthCard title="메일을 확인해 주세요">
      <VerifyEmailForm
        {...getAuthUiOptions()}
        email={typeof email === "string" ? email : undefined}
      />
    </AuthCard>
  );
}

export default function VerifyEmailPage(props: AuthPageProps) {
  return (
    <Suspense fallback={<AuthLoading />}>
      <VerifyEmailContent {...props} />
    </Suspense>
  );
}
