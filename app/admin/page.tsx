import { requireOperatorPage } from "@/lib/auth/session";
import { getOperatorHome } from "@/features/admin/queries";

export default async function AdminHome() {
  await requireOperatorPage();
  const { branches } = await getOperatorHome();
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
      <h1 className="text-2xl font-semibold">운영자 화면</h1>
      <section aria-labelledby="branches-heading" className="space-y-4">
        <h2 id="branches-heading" className="text-lg font-semibold">
          운영 지점
        </h2>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {branches.map((branch) => (
            <li key={branch.id} className="p-5">
              {branch.name}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
