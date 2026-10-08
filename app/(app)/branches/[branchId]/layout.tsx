import { Suspense, type ReactNode } from "react";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { getSession } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import { getBranchNavigation } from "@/features/bookings/queries";
import { BranchNavigation } from "@/features/bookings/components/branch-navigation";
import { BranchWorkspace } from "@/features/bookings/components/branch-workspace";
import { BranchDisplayClockProvider } from "@/features/bookings/components/branch-display-clock";
import {
  FloorNavigationSkeleton,
  FloorPageSkeleton,
} from "@/features/bookings/components/booking-skeletons";
import { PageContainer } from "@/components/page-container";
import {
  FloorViewProvider,
  FloorViewControl,
} from "@/features/bookings/components/floor-view";
import { resolveFloorView } from "@/features/bookings/floor-view";

function NavigationFallback() {
  return (
    <PageContainer width="wide">
      <FloorNavigationSkeleton />
    </PageContainer>
  );
}
async function NavigationContent({
  params,
}: {
  params: Promise<{ branchId: string }>;
}) {
  if (!(await getSession())) return <NavigationFallback />;
  const { branchId } = await params;
  const data = await getBranchNavigation(branchId).catch((error: unknown) => {
    if (error instanceof ActionError && error.code === "NOT_FOUND") notFound();
    throw error;
  });
  return (
    <Suspense fallback={<NavigationFallback />}>
      <BranchNavigation data={data} viewControl={<FloorViewControl />} />
    </Suspense>
  );
}
async function BranchRequestLayout({
  params,
  children,
}: {
  params: Promise<{ branchId: string }>;
  children: ReactNode;
}) {
  const { branchId } = await params;
  const cookieView = resolveFloorView(
    undefined,
    (await cookies()).get("floor_view")?.value,
  );
  return (
    <BranchDisplayClockProvider branchId={branchId.toLowerCase()}>
      <FloorViewProvider cookieView={cookieView}>
        <BranchWorkspace>
          <Suspense fallback={<NavigationFallback />}>
            <NavigationContent params={params} />
          </Suspense>
          {children}
        </BranchWorkspace>
      </FloorViewProvider>
    </BranchDisplayClockProvider>
  );
}
export default function BranchLayout({
  params,
  children,
}: {
  params: Promise<{ branchId: string }>;
  children: ReactNode;
}) {
  return (
    <Suspense fallback={<FloorPageSkeleton />}>
      <BranchRequestLayout params={params}>{children}</BranchRequestLayout>
    </Suspense>
  );
}
