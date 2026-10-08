import type { ReactNode } from "react";
import { PageContainer, PageHeading } from "@/components/page-container";

export function BranchListFrame({ children }: { children: ReactNode }) {
  return (
    <PageContainer as="main" width="branches" className="space-y-6">
      <PageHeading
        title="지점"
        description="이용할 지점을 골라 주세요. 층과 공간은 지점 안에서 고를 수 있어요."
      />
      {children}
    </PageContainer>
  );
}
