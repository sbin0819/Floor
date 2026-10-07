import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import {
  AuthCard,
  AuthLoading,
  type AuthPageProps,
} from "@/features/auth/components/auth-card";
import { SignupForm } from "@/features/auth/components/signup-form";
import { getAuthUiOptions } from "@/lib/auth/auth";
import { getSession } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/safe-next";

async function SignupContent({ searchParams }: AuthPageProps) {
  await connection();
  const query = await searchParams;
  const next = safeNext(query.next);
  if (await getSession()) redirect(next);
  return (
    <AuthCard
      title="Floor 계정 만들기"
      description="내 공간과 동료를 연결해요."
    >
      <SignupForm {...getAuthUiOptions()} next={next} />
    </AuthCard>
  );
}

export default function SignupPage(props: AuthPageProps) {
  return (
    <Suspense fallback={<AuthLoading variant="signup" />}>
      <SignupContent {...props} />
    </Suspense>
  );
}
