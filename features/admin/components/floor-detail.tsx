import type { AdminFloorData } from "@/features/admin/types";
import { AdminBreadcrumb } from "./admin-breadcrumb";
import { FloorForm } from "./floor-form";
import { SpaceTable } from "./space-table";
import { AccessEditor } from "./access-editor";

export function FloorDetail({ data }: { data: AdminFloorData }) {
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6 lg:p-8">
      <AdminBreadcrumb branch={data.branch} floor={data.floor} />
      <h1 className="text-2xl font-semibold">{data.floor.name} 관리</h1>
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="space-y-4 rounded-xl border bg-card p-5">
          <h2 className="text-lg font-semibold">층 정보</h2>
          <FloorForm
            key={data.floor.id}
            branchId={data.branch.id}
            floor={data.floor}
            canManage={data.permissions.manageSpaces}
          />
        </section>
        <section className="rounded-xl border bg-card p-5">
          <AccessEditor key={data.floor.id} data={data} />
        </section>
      </div>
      <SpaceTable data={data} />
    </main>
  );
}
