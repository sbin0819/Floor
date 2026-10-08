import type { ReactNode } from "react";
import { PageContainer, PageHeading } from "@/components/page-container";
import { Skeleton } from "@/components/ui/skeleton";

export function PeopleShell({
  title,
  children,
}: {
  title: "친구" | "설정";
  children: ReactNode;
}) {
  return (
    <PageContainer as="main" className="space-y-6">
      <PageHeading title={title} />
      {children}
    </PageContainer>
  );
}
export function PeopleSkeleton({ settings = false }: { settings?: boolean }) {
  return (
    <div aria-busy="true" className="space-y-6">
      <span role="status" className="sr-only">
        불러오고 있어요
      </span>
      <section className="space-y-4 rounded-xl border border-border bg-card p-5">
        <h2 className="font-semibold">{settings ? "프로필" : "친구 추가"}</h2>
        <Skeleton className="h-11 w-full" />
      </section>
      {!settings && (
        <div className="space-y-4">
          <div className="flex gap-6 text-sm text-muted-foreground">
            <span>모두</span>
            <span>받은 요청</span>
            <span>보낸 요청</span>
          </div>
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-20 w-full" />
          ))}
        </div>
      )}
    </div>
  );
}
