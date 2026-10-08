import { Suspense } from "react";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import {
  AuthCard,
  AuthFormSkeleton,
} from "@/features/auth/components/auth-card";
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
    return <OperatorAccountNotice />;
  }
  return (
    <>
      <p className="text-sm text-muted-foreground">
        운영자 계정의 이메일로 로그인해 주세요.
      </p>
      <LoginForm operator />
    </>
  );
}

export default function OperatorLoginPage() {
  return (
    <AuthCard title="운영자 로그인">
      <Suspense fallback={<AuthFormSkeleton variant="operator" />}>
        <OperatorLoginContent />
      </Suspense>
    </AuthCard>
  );
}
