import Link from "next/link";
import type { AdminBranchData } from "@/features/admin/types";
import { BranchForm } from "./branch-form";
import { AddFloorDialog } from "./floor-form";
import { AdminBreadcrumb } from "./admin-breadcrumb";

const accessLabels = { everyone: "모두", teams: "지정한 팀", closed: "닫힘" };
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
        {data.floors.length === 0 ? (
          <p className="text-muted-foreground">
            층이 아직 없어요. 층을 더해 주세요
          </p>
        ) : (
          <ul className="divide-y">
            {data.floors.map((floor) => (
              <li key={floor.id}>
                <Link
                  href={`/admin/branches/${data.branch.id}/floors/${floor.id}`}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-3 py-4"
                >
                  <span>
                    {floor.name}{" "}
                    <span className="text-muted-foreground tabular-nums">
                      ({floor.level}층)
                    </span>
                  </span>
                  <span className="text-muted-foreground tabular-nums">
                    {accessLabels[floor.access]} · 공간 {floor.spaceCount}곳
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
