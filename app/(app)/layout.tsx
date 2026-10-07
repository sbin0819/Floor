import { Suspense, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { MobileNav } from "@/components/mobile-nav";
import { HomeSkeleton } from "@/features/teams/components/team-skeletons";

export default function MemberLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppHeader />
      <div className="pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <Suspense fallback={<HomeSkeleton />}>
          {children}
        </Suspense>
      </div>
      <MobileNav />
    </>
  );
}
