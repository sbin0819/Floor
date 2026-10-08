import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getBranchList } from "@/features/bookings/queries";
import { BranchListContent } from "@/features/bookings/components/branch-list";
import { BranchListFrame } from "@/features/bookings/components/branch-list-frame";
import { BranchListContentSkeleton } from "@/features/bookings/components/booking-skeletons";

async function BranchesContent() {
  await requirePageSession("/branches");
  return <BranchListContent branches={await getBranchList()} />;
}
export default function BranchesPage() {
  return (
    <BranchListFrame>
      <Suspense fallback={<BranchListContentSkeleton />}>
        <BranchesContent />
      </Suspense>
    </BranchListFrame>
  );
}
