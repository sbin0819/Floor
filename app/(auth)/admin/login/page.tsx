import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { AuthCard, AuthLoading } from "@/features/auth/components/auth-card";
import { LoginForm } from "@/features/auth/components/login-form";
import { OperatorAccountNotice } from "@/features/auth/components/operator-account-notice";
import { getSession } from "@/lib/auth/session";
import { getOperatorBranches } from "@/lib/dal";

async function OperatorLoginContent() {
  await connection();
  const session = await getSession();
  if (session) {
    const branches = await getOperatorBranches(session.userId);
    if (branches.length > 0) redirect("/admin");
    return (
      <AuthCard title="운영자 로그인">
        <OperatorAccountNotice />
      </AuthCard>
    );
  }
  return (
    <AuthCard
      title="운영자 로그인"
      description="운영자 계정의 이메일로 로그인해 주세요."
    >
      <LoginForm operator />
    </AuthCard>
  );
}

export default function OperatorLoginPage() {
  return (
    <Suspense fallback={<AuthLoading variant="operator" />}>
      <OperatorLoginContent />
    </Suspense>
  );
}
