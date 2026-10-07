import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireOperatorPage } from "@/lib/auth/session";
import {
  getOperatorBranchCards,
  getOperatorHome,
} from "@/features/admin/queries";
import { AdminHomeSkeleton } from "@/features/admin/components/admin-skeletons";
import { AdminBreadcrumb } from "@/features/admin/components/admin-breadcrumb";
import { OperatorBranchCards } from "@/features/admin/components/operator-branch-cards";

async function AdminContent() {
  await requireOperatorPage();
  const { branches } = await getOperatorHome();
  if (branches.length === 1) redirect(`/admin/branches/${branches[0]!.id}`);
  const cards = await getOperatorBranchCards();
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
      <AdminBreadcrumb />
      <h1 className="text-2xl font-semibold">운영자 화면</h1>
      <section aria-labelledby="branches-heading" className="space-y-4">
        <h2 id="branches-heading" className="text-lg font-semibold">
          운영 지점
        </h2>
        <OperatorBranchCards branches={cards.branches} />
      </section>
    </main>
  );
}

export default function AdminHome() {
  return (
    <Suspense fallback={<AdminHomeSkeleton />}>
      <AdminContent />
    </Suspense>
  );
}
