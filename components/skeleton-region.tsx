import type { ReactNode } from "react";
import { PageContainer, type PageWidth } from "@/components/page-container";

export function SkeletonRegion({
  children,
  className,
  width,
}: {
  children: ReactNode;
  className?: string;
  width?: PageWidth;
}) {
  const content = (
    <>
      <span role="status" className="sr-only">
        불러오고 있어요.
      </span>
      {children}
    </>
  );
  if (width)
    return (
      <PageContainer
        width={width}
        data-slot="skeleton-region"
        aria-busy="true"
        className={className}
      >
        {content}
      </PageContainer>
    );
  return (
    <div data-slot="skeleton-region" aria-busy="true" className={className}>
      {content}
    </div>
  );
}
