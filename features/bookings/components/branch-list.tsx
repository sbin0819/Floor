"use client";

import { useRouter } from "next/navigation";
import { PageContainer, PageHeading } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { setDefaultBranch } from "@/features/bookings/actions";
import type { BranchListItem } from "@/features/bookings/types";
import { useBookingMutation } from "./use-booking-mutation";

export function BranchList({ branches }: { branches: BranchListItem[] }) {
  const router = useRouter();
  const mutation = useBookingMutation({
    action: setDefaultBranch,
    successMessage: "기본 지점을 저장했어요",
    onSuccess: ({ branchId }) => router.push(`/branches/${branchId}`),
  });
  return (
    <PageContainer as="main" className="space-y-6">
      <PageHeading title="이용할 지점을 골라 주세요" />
      {branches.length === 0 && (
        <p className="text-muted-foreground">
          이용할 수 있는 지점이 아직 없어요
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {branches.map((branch) => (
          <Card key={branch.id}>
            <CardHeader>
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-xl font-semibold">{branch.name}</h2>
                {branch.isDefault && (
                  <Badge variant="secondary">기본 지점</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                {branch.address ?? "주소 정보가 없어요"}
              </p>
              <p className="tabular-nums">
                {branch.todayHours
                  ? `오늘 ${branch.todayHours.open}–${branch.todayHours.close}`
                  : "오늘은 쉬는 날이에요"}
              </p>
              <Button
                variant="outline"
                disabled={mutation.pending}
                onClick={() => void mutation.submit({ branchId: branch.id })}
              >
                {branch.name} 선택
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <p role="status" aria-live="polite">
        {mutation.message}
      </p>
    </PageContainer>
  );
}
