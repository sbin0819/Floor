"use client";

import Link from "next/link";
import { useState } from "react";
import { Building2, ChevronRight, LoaderCircle, Star } from "lucide-react";
import { LinkPending } from "@/components/link-pending";
import { PageContainer, PageHeading } from "@/components/page-container";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { setDefaultBranch } from "@/features/bookings/actions";
import type { BranchListItem } from "@/features/bookings/types";
import type { OperatingState } from "@/features/bookings/operating-state";
import { useBookingMutation } from "./use-booking-mutation";

export function BranchOperatingStatus({ state }: { state: OperatingState }) {
  const text =
    state.status === "open"
      ? `영업 중 · ${state.hours?.close}까지`
      : state.status === "before_open"
        ? `${state.hours?.open}에 열어요`
        : state.status === "after_close"
          ? "오늘 영업이 끝났어요"
          : "쉬는 날이에요";
  return (
    <p className="flex items-center gap-2 text-sm tabular-nums">
      {state.status === "open" && (
        <span
          aria-hidden="true"
          className="size-2 rounded-full bg-status-free-strong"
        />
      )}
      {text}
    </p>
  );
}

export function BranchList({ branches }: { branches: BranchListItem[] }) {
  const [saving, setSaving] = useState<string | null>(null);
  const mutation = useBookingMutation({
    action: setDefaultBranch,
    successMessage: "기본 지점을 저장했어요",
  });
  return (
    <PageContainer as="main" className="space-y-6">
      <PageHeading
        title="지점"
        description="이용할 지점을 골라 주세요. 층과 공간은 지점 안에서 고를 수 있어요."
      />
      {branches.length === 0 && (
        <p className="text-muted-foreground">
          이용할 수 있는 지점이 아직 없어요
        </p>
      )}
      <div className="grid gap-5 sm:grid-cols-2">
        {branches.map((branch) => (
          <div key={branch.id} className="space-y-3">
            <Link
              href={`/branches/${branch.id}`}
              className="relative block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <LinkPending />
              <Card className={branch.isDefault ? "border-primary" : undefined}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-xl font-semibold">{branch.name}</h2>
                    {branch.isDefault && (
                      <Badge variant="secondary">
                        <Star aria-hidden="true" className="size-3" />
                        기본 지점
                      </Badge>
                    )}
                    <ChevronRight
                      aria-hidden="true"
                      className="ml-auto size-4 shrink-0 text-muted-foreground"
                    />
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="text-muted-foreground">
                    {branch.address ?? "주소 정보가 없어요"}
                  </p>
                  <BranchOperatingStatus state={branch.operatingState} />
                  <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4 text-sm text-muted-foreground tabular-nums">
                    {branch.accessibleFloorCount === 0 ? (
                      "이용할 수 있는 층이 아직 없어요"
                    ) : (
                      <>
                        <span className="flex items-center gap-2">
                          <Building2 aria-hidden="true" className="size-4" />층{" "}
                          {branch.accessibleFloorCount}개
                        </span>
                        {branch.freeSpaceCount !== null && (
                          <span>지금 빈 공간 {branch.freeSpaceCount}곳</span>
                        )}
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
            {branch.isDefault ? (
              <p className="px-1 text-xs text-muted-foreground">
                홈과 공간 예약이 이 지점으로 먼저 열려요
              </p>
            ) : (
              <Button
                variant="ghost"
                disabled={mutation.pending}
                aria-label={`${branch.name} 기본 지점으로 설정`}
                onClick={() => {
                  setSaving(branch.id);
                  void mutation.submit({ branchId: branch.id });
                }}
              >
                {mutation.pending && saving === branch.id ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="animate-spin motion-reduce:animate-none"
                  />
                ) : (
                  <Star aria-hidden="true" />
                )}
                {mutation.pending && saving === branch.id
                  ? "저장하고 있어요"
                  : "기본 지점으로 설정"}
              </Button>
            )}
          </div>
        ))}
      </div>
      <p role="status" aria-live="polite">
        {mutation.message}
      </p>
    </PageContainer>
  );
}
