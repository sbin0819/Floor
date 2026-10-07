"use client";

import { useState, type SubmitEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  requestTeamJoin,
  cancelTeamJoinRequest,
  approveTeamJoinRequest,
  rejectTeamJoinRequest,
} from "@/features/teams/join-request-actions";
import { revokeTeamInvite } from "@/features/teams/invite-management-actions";
import { createJoinRequestSchema } from "@/features/teams/schema";
import { TeamFeedback, TeamMessage } from "./team-fields";
import { useTeamMutation, validationErrors } from "./use-team-mutation";

export function JoinRequestForm({
  teamId,
  teamName,
}: {
  teamId: string;
  teamName: string;
}) {
  const mutation = useTeamMutation({
    action: requestTeamJoin,
    successMessage: "가입 요청을 보냈어요. 팀 관리자가 승인하면 팀원이 돼요",
    limitMessage: "대기 중인 가입 요청은 10개까지 보낼 수 있어요",
  });
  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const parsed = createJoinRequestSchema.safeParse({
      teamId,
      message: new FormData(form).get("message"),
    });
    if (!parsed.success) {
      mutation.setErrors(validationErrors(parsed.error.issues));
      return;
    }
    if (await mutation.submit(parsed.data)) form.reset();
  }
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-3"
      aria-label={`${teamName} 가입 요청`}
      aria-busy={mutation.pending}
    >
      <TeamMessage
        disabled={mutation.pending}
        error={mutation.errors.message}
      />
      <TeamFeedback message={mutation.message} />
      <Button variant="outline" type="submit" disabled={mutation.pending}>
        가입 요청
      </Button>
    </form>
  );
}

export function CancelJoinRequest({ requestId }: { requestId: string }) {
  const mutation = useTeamMutation({
    action: cancelTeamJoinRequest,
    successMessage: "가입 요청을 취소했어요",
  });
  return (
    <div className="space-y-2">
      <Button
        variant="destructive"
        disabled={mutation.pending}
        onClick={() => void mutation.submit({ requestId })}
      >
        요청 취소
      </Button>
      <TeamFeedback message={mutation.message} />
    </div>
  );
}

export function ReviewJoinRequest({ requestId }: { requestId: string }) {
  const [latestAction, setLatestAction] = useState<"approve" | "reject">(
    "approve",
  );
  const approve = useTeamMutation({
    action: approveTeamJoinRequest,
    successMessage: "가입 요청을 승인했어요",
    onStart: () => setLatestAction("approve"),
  });
  const reject = useTeamMutation({
    action: rejectTeamJoinRequest,
    successMessage: "가입 요청을 거절했어요",
    onStart: () => setLatestAction("reject"),
  });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={approve.pending}
          onClick={() => void approve.submit({ requestId })}
        >
          승인
        </Button>
        <Button
          variant="destructive"
          disabled={reject.pending}
          onClick={() => void reject.submit({ requestId })}
        >
          거절
        </Button>
      </div>
      <TeamFeedback
        message={latestAction === "approve" ? approve.message : reject.message}
      />
    </div>
  );
}

export function RevokeInvite({ inviteId }: { inviteId: string }) {
  const mutation = useTeamMutation({
    action: revokeTeamInvite,
    successMessage: "초대를 취소했어요",
  });
  return (
    <div className="space-y-2">
      <Button
        variant="destructive"
        disabled={mutation.pending}
        onClick={() => void mutation.submit({ inviteId })}
      >
        초대 취소
      </Button>
      <TeamFeedback message={mutation.message} />
    </div>
  );
}
