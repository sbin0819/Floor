import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import {
  AuthCard,
  AuthFormSkeleton,
  type AuthPageProps,
} from "@/features/auth/components/auth-card";
import { SignupForm } from "@/features/auth/components/signup-form";
import { MemberAuthFrame } from "@/features/auth/components/member-auth-frame";
import { getAuthUiOptions } from "@/lib/auth/auth";
import { getSession } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/safe-next";

async function SignupContent({ searchParams }: AuthPageProps) {
  await connection();
  const query = await searchParams;
  const next = safeNext(query.next);
  if (await getSession()) redirect(next);
  return <SignupForm {...getAuthUiOptions()} next={next} />;
}

export default function SignupPage(props: AuthPageProps) {
  return (
    <MemberAuthFrame>
      <AuthCard
        title="Floor 계정 만들기"
        description="내 공간과 동료를 연결해요."
      >
        <Suspense fallback={<AuthFormSkeleton variant="signup" />}>
          <SignupContent {...props} />
        </Suspense>
      </AuthCard>
    </MemberAuthFrame>
  );
}
