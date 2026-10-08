import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import {
  AuthCard,
  AuthFormSkeleton,
  type AuthPageProps,
} from "@/features/auth/components/auth-card";
import { LoginForm } from "@/features/auth/components/login-form";
import { MemberAuthFrame } from "@/features/auth/components/member-auth-frame";
import { getLoginNotice } from "@/features/auth/messages";
import { getAuthUiOptions } from "@/lib/auth/auth";
import { getSession } from "@/lib/auth/session";
import { safeNext } from "@/lib/auth/safe-next";

async function LoginContent({ searchParams }: AuthPageProps) {
  await connection();
  const query = await searchParams;
  const next = safeNext(query.next);
  if (await getSession()) redirect(next);
  const { providers } = getAuthUiOptions();
  return (
    <LoginForm
      providers={providers}
      next={next}
      notice={getLoginNotice(query.error, query.verified)}
    />
  );
}

export default function LoginPage(props: AuthPageProps) {
  return (
    <MemberAuthFrame>
      <AuthCard
        title="Floor에 로그인"
        description="함께 일할 공간을 만나 보세요."
      >
        <Suspense fallback={<AuthFormSkeleton />}>
          <LoginContent {...props} />
        </Suspense>
      </AuthCard>
    </MemberAuthFrame>
  );
}
