import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import type { AdminBranchData } from "@/features/admin/types";

const accessLabels = { everyone: "모두", teams: "지정한 팀", closed: "닫힘" };

export function AdminFloorList({
  branchId,
  floors,
}: {
  branchId: string;
  floors: AdminBranchData["floors"];
}) {
  if (floors.length === 0)
    return (
      <p className="text-muted-foreground">
        층이 아직 없어요. 층을 더해 주세요
      </p>
    );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[340px] border-collapse text-left text-sm">
        <caption className="sr-only">층 목록</caption>
        <thead className="border-b border-border text-xs text-muted-foreground">
          <tr>
            <th scope="col" className="p-3 font-medium">
              층 번호
            </th>
            <th scope="col" className="p-3 font-medium">
              이름
            </th>
            <th scope="col" className="p-3 font-medium">
              이용 대상
            </th>
            <th scope="col" className="p-3 text-right font-medium">
              공간 수
            </th>
          </tr>
        </thead>
        <tbody>
          {floors.map((floor) => (
            <tr
              key={floor.id}
              className="relative border-b border-border focus-within:bg-muted/50 hover:bg-muted/50"
            >
              <th scope="row" className="px-3 py-1 font-medium">
                <Link
                  href={`/admin/branches/${branchId}/floors/${floor.id}`}
                  aria-label={`${floor.level}층 ${floor.name}`}
                  className="inline-flex min-h-11 items-center tabular-nums after:absolute after:inset-0 after:rounded-md focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring"
                >
                  {floor.level}층
                </Link>
              </th>
              <td className="p-3">{floor.name}</td>
              <td className="p-3">
                <Badge variant="secondary" className="h-6">
                  {accessLabels[floor.access]}
                </Badge>
              </td>
              <td className="p-3 text-right tabular-nums">
                {floor.spaceCount}곳
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
