import type { ReactNode } from "react";
import { AdminBreadcrumb } from "./admin-breadcrumb";

export function AdminHomeShell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
      <AdminBreadcrumb />
      <h1 className="text-2xl font-semibold">운영자 화면</h1>
      <section aria-labelledby="branches-heading" className="space-y-4">
        <h2 id="branches-heading" className="text-lg font-semibold">
          운영 지점
        </h2>
        {children}
      </section>
    </main>
  );
}
