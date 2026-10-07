import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getBranchList } from "@/features/bookings/queries";
import { BranchList } from "@/features/bookings/components/branch-list";
import { BranchListSkeleton } from "@/features/bookings/components/booking-skeletons";

async function BranchesContent() {
  await requirePageSession("/branches");
  return <BranchList branches={await getBranchList()} />;
}
export default function BranchesPage() {
  return (
    <Suspense fallback={<BranchListSkeleton />}>
      <BranchesContent />
    </Suspense>
  );
}
