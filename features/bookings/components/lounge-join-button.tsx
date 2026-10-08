"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { joinLounge } from "@/features/chat/space-actions";
import type { BranchLounge } from "@/features/bookings/types";
import { useSpaceMutation } from "@/features/chat/components/use-space-mutation";

export function LoungeJoinButton({
  branchId,
  lounge,
}: {
  branchId: string;
  lounge: BranchLounge;
}) {
  if (lounge.joined && lounge.spaceId)
    return (
      <Button asChild variant="outline">
        <Link href={`/s/${lounge.spaceId}`}>
          <MessagesSquare aria-hidden="true" />
          라운지 열기
        </Link>
      </Button>
    );
  return <JoinLounge branchId={branchId} />;
}

function JoinLounge({ branchId }: { branchId: string }) {
  const router = useRouter();
  const mutation = useSpaceMutation(joinLounge);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        variant="outline"
        disabled={mutation.pending}
        onClick={() =>
          void mutation.submit(
            { branchId },
            ({ spaceId }) => router.push(`/s/${spaceId}`),
            "라운지에 참여했어요",
          )
        }
      >
        <MessagesSquare aria-hidden="true" />
        {mutation.pending ? "참여하고 있어요" : "라운지 참여"}
      </Button>
      {mutation.error && (
        <span role="alert" className="text-xs text-destructive">
          {mutation.error}
        </span>
      )}
    </span>
  );
}
