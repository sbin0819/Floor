"use client";

import { Button } from "@/components/ui/button";
import { PageContainer } from "@/components/page-container";

export function RouteError({ retry }: { retry: () => void }) {
  return (
    <PageContainer as="main" className="space-y-6 py-16">
      <h1 className="text-2xl font-semibold">
        문제가 생겼어요. 잠시 뒤 다시 시도해 주세요
      </h1>
      <Button onClick={() => retry()} variant="outline">
        다시 시도
      </Button>
    </PageContainer>
  );
}
