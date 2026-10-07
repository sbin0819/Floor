import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { LinkPending } from "@/components/link-pending";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { OperatorBranchCard } from "@/features/admin/types";

export function OperatorBranchCards({
  branches,
}: {
  branches: OperatorBranchCard[];
}) {
  return (
    <ul className="grid gap-5 sm:grid-cols-2">
      {branches.map((branch) => {
        const state = branch.operatingState;
        const status =
          state.status === "open"
            ? `영업 중 · ${state.hours?.close}까지`
            : state.status === "before_open"
              ? `${state.hours?.open}에 열어요`
              : state.status === "after_close"
                ? "오늘 영업이 끝났어요"
                : "쉬는 날이에요";
        return (
          <li key={branch.id}>
            <Link
              href={`/admin/branches/${branch.id}`}
              className="relative block h-full rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <LinkPending />
              <Card className="h-full">
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-xl font-semibold break-all">
                      {branch.name}
                    </h3>
                    <ChevronRight
                      aria-hidden="true"
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-sm break-words text-muted-foreground">
                    {branch.address ?? "주소 정보가 없어요"}
                  </p>
                  <p className="text-sm tabular-nums">{status}</p>
                  <p className="border-t pt-4 text-sm text-muted-foreground tabular-nums">
                    층 {branch.floorCount}개 · 공간 {branch.spaceCount}곳
                  </p>
                </CardContent>
              </Card>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
