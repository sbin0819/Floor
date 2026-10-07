import { Suspense, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { MobileNav } from "@/components/mobile-nav";

export default function MemberLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppHeader />
      <div className="pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <Suspense
          fallback={
            <p className="p-6 text-muted-foreground">불러오고 있어요.</p>
          }
        >
          {children}
        </Suspense>
      </div>
      <MobileNav />
    </>
  );
}
