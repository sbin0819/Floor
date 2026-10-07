"use client";

import type { SubmitEvent } from "react";
import { Button } from "@/components/ui/button";
import { sendTeamInvite } from "@/features/teams/invite-management-actions";
import { sendInviteSchema } from "@/features/teams/schema";
import { TeamFeedback, TeamInput, TeamMessage } from "./team-fields";
import { useTeamMutation, validationErrors } from "./use-team-mutation";
import { TeamActionLabel } from "./team-action-label";

export function SendInviteForm({
  teamId,
  canSendEmail,
  onSuccess,
}: {
  teamId: string;
  canSendEmail: boolean;
  onSuccess?: () => void;
}) {
  const mutation = useTeamMutation({
    action: sendTeamInvite,
    successMessage: "초대를 만들었어요",
    limitMessage: "팀의 대기 중인 초대는 50개까지 만들 수 있어요",
    onSuccess,
  });
  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const parsed = sendInviteSchema.safeParse({
      teamId,
      email: values.get("email"),
      message: values.get("message"),
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
      className="space-y-4"
      aria-label="초대 보내기"
      aria-busy={mutation.pending}
    >
      {!canSendEmail && (
        <p className="rounded-lg border border-border bg-muted p-3 text-sm">
          지금은 초대 메일을 보낼 수 없어요. 초대는 등록되고, 초대받은 분이 같은
          이메일로 로그인하면 받은 초대에서 확인할 수 있어요.
        </p>
      )}
      <TeamInput
        name="email"
        label="이메일 주소"
        type="email"
        autoComplete="email"
        required
        error={mutation.errors.email}
        disabled={mutation.pending}
      />
      <TeamMessage
        error={mutation.errors.message}
        disabled={mutation.pending}
      />
      <p className="text-xs text-muted-foreground">
        초대는 7일 뒤 만료돼요. 같은 이메일로 다시 보내면 이전 초대는 취소돼요.
      </p>
      <TeamFeedback message={mutation.message} />
      <Button type="submit" className="min-w-36" disabled={mutation.pending}>
        <TeamActionLabel
          pending={mutation.ownPending}
          label="초대 보내기"
          pendingLabel="보내고 있어요"
        />
      </Button>
    </form>
  );
}
