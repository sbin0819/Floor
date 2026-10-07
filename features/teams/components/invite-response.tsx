"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  acceptTeamInvite,
  declineTeamInvite,
} from "@/features/teams/invite-response-actions";
import { TeamFeedback } from "./team-fields";
import { useTeamMutation } from "./use-team-mutation";
import { TeamActionLabel } from "./team-action-label";

export function InviteResponse({
  token,
  leaveOnDecline = false,
}: {
  token: string;
  leaveOnDecline?: boolean;
}) {
  const router = useRouter();
  const [latestAction, setLatestAction] = useState<"accept" | "decline">(
    "accept",
  );
  const accept = useTeamMutation({
    action: acceptTeamInvite,
    successMessage: "초대를 수락했어요",
    onStart: () => setLatestAction("accept"),
    onSuccess: (data) => router.push(`/teams/${data.teamId}`),
  });
  const decline = useTeamMutation({
    action: declineTeamInvite,
    successMessage: "초대를 거절했어요",
    onStart: () => setLatestAction("decline"),
    onSuccess: () => {
      if (leaveOnDecline) router.push("/teams");
    },
  });
  return (
    <div
      className="space-y-3"
      data-team-pending={accept.ownPending || decline.ownPending}
    >
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={accept.pending}
          className="min-w-36"
          onClick={() => void accept.submit({ token })}
        >
          <TeamActionLabel
            pending={accept.ownPending}
            label="수락"
            pendingLabel="수락하고 있어요"
          />
        </Button>
        <Button
          variant="outline"
          className="min-w-36"
          disabled={decline.pending}
          onClick={() => void decline.submit({ token })}
        >
          <TeamActionLabel
            pending={decline.ownPending}
            label="거절"
            pendingLabel="거절하고 있어요"
          />
        </Button>
      </div>
      <TeamFeedback
        message={latestAction === "accept" ? accept.message : decline.message}
      />
    </div>
  );
}
