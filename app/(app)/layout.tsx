import { Suspense, type ReactNode } from "react";
import { AppHeader } from "@/components/app-header";
import { MobileNav } from "@/components/mobile-nav";
import { HomeDashboardSkeleton } from "@/features/bookings/components/home-skeletons";

export default function MemberLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <AppHeader />
      <div className="pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-0">
        <Suspense fallback={<HomeDashboardSkeleton />}>
          {children}
        </Suspense>
      </div>
      <MobileNav />
    </>
  );
}
