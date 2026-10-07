import { Suspense, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";

export default function MemberLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppHeader />
      <Suspense
        fallback={<p className="p-6 text-muted-foreground">불러오고 있어요.</p>}
      >
        {children}
      </Suspense>
    </>
  );
}
