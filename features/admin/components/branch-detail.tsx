import type { AdminBranchData } from "@/features/admin/types";
import { BranchForm } from "./branch-form";
import { AddFloorDialog } from "./floor-form";
import { AdminBreadcrumb } from "./admin-breadcrumb";
import { AdminFloorList } from "./floor-list";

export function BranchDetail({ data }: { data: AdminBranchData }) {
  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6 lg:p-8">
      <AdminBreadcrumb branch={data.branch} />
      <h1 className="text-2xl font-semibold">{data.branch.name}</h1>
      <BranchForm
        key={data.branch.id}
        branch={data.branch}
        canManage={data.permissions.manageSpaces}
      />
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-lg font-semibold">층</h2>
          <AddFloorDialog
            branchId={data.branch.id}
            disabled={!data.permissions.manageSpaces}
          />
        </div>
        <AdminFloorList branchId={data.branch.id} floors={data.floors} />
      </section>
    </main>
  );
}
