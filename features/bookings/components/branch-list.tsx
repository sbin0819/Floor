"use client";

import { useState } from "react";
import { PageContainer, PageHeading } from "@/components/page-container";
import { setDefaultBranch } from "@/features/bookings/actions";
import type { BranchListItem } from "@/features/bookings/types";
import { BranchCard } from "./branch-card";
import { useBookingMutation } from "./use-booking-mutation";

export { BranchOperatingStatus } from "./branch-card";

export function BranchList({ branches }: { branches: BranchListItem[] }) {
  const [saving, setSaving] = useState<string | null>(null);
  const mutation = useBookingMutation({
    action: setDefaultBranch,
    successMessage: "기본 지점을 저장했어요",
  });
  return (
    <PageContainer as="main" width="branches" className="space-y-6">
      <PageHeading
        title="지점"
        description="이용할 지점을 골라 주세요. 층과 공간은 지점 안에서 고를 수 있어요."
      />
      {branches.length === 0 && (
        <p className="text-muted-foreground">
          이용할 수 있는 지점이 아직 없어요
        </p>
      )}
      <div className="grid gap-5 lg:grid-cols-2">
        {branches.map((branch) => (
          <BranchCard
            key={branch.id}
            branch={branch}
            pending={mutation.pending}
            saving={saving === branch.id}
            onSetDefault={() => {
              setSaving(branch.id);
              void mutation.submit({ branchId: branch.id });
            }}
          />
        ))}
      </div>
      <p role="status" aria-live="polite">
        {mutation.message}
      </p>
    </PageContainer>
  );
}
