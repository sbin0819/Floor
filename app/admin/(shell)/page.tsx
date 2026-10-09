import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireOperatorPage } from "@/lib/auth/session";
import {
  getOperatorBranchCards,
  getOperatorHome,
} from "@/features/admin/queries";
import { AdminBranchCardsSkeleton } from "@/features/admin/components/admin-skeletons";
import { AdminHomeShell } from "@/features/admin/components/admin-home-shell";
import { OperatorBranchCards } from "@/features/admin/components/operator-branch-cards";

async function AdminContent() {
  await requireOperatorPage();
  const { branches } = await getOperatorHome();
  if (branches.length === 1) redirect(`/admin/branches/${branches[0]!.id}`);
  const cards = await getOperatorBranchCards();
  return <OperatorBranchCards branches={cards.branches} />;
}

export default function AdminHome() {
  return (
    <AdminHomeShell>
      <Suspense fallback={<AdminBranchCardsSkeleton />}>
        <AdminContent />
      </Suspense>
    </AdminHomeShell>
  );
}
