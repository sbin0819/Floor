import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireOperatorPage } from "@/lib/auth/session";
import { getOperatorHome } from "@/features/admin/queries";

async function AdminContent() {
  await requireOperatorPage();
  const { branches } = await getOperatorHome();
  if (branches.length === 1) redirect(`/admin/branches/${branches[0]!.id}`);
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <h1 className="text-2xl font-semibold">운영자 화면</h1>
      <section aria-labelledby="branches-heading" className="space-y-4">
        <h2 id="branches-heading" className="text-lg font-semibold">
          운영 지점
        </h2>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {branches.map((branch) => (
            <li key={branch.id}>
              <Link
                className="flex min-h-11 p-5 hover:bg-muted"
                href={`/admin/branches/${branch.id}`}
              >
                {branch.name}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

export default function AdminHome() {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6 text-muted-foreground">
          운영자 화면을 불러오고 있어요.
        </p>
      }
    >
      <AdminContent />
    </Suspense>
  );
}
