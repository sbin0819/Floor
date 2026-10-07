import { Suspense } from "react";
import { requirePageSession } from "@/lib/auth/session";
import { getBranchList } from "@/features/bookings/queries";
import { BranchList } from "@/features/bookings/components/branch-list";

async function BranchesContent() {
  await requirePageSession("/branches");
  return <BranchList branches={await getBranchList()} />;
}
export default function BranchesPage() {
  return (
    <Suspense
      fallback={
        <p role="status" className="p-6 text-muted-foreground">
          지점을 불러오고 있어요.
        </p>
      }
    >
      <BranchesContent />
    </Suspense>
  );
}
