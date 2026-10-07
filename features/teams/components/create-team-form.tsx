"use client";

import { useState, type SubmitEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { createTeam } from "@/features/teams/create-team-action";
import { createTeamSchema } from "@/features/teams/schema";
import { BranchSelect, TeamFeedback, TeamInput } from "./team-fields";
import { useTeamMutation, validationErrors } from "./use-team-mutation";

export function CreateTeamForm({
  branches,
}: {
  branches: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [branchId, setBranchId] = useState("");
  const mutation = useTeamMutation({
    action: createTeam,
    successMessage: "팀을 만들었어요",
    limitMessage: "관리하는 팀은 5개까지 만들 수 있어요",
    onSuccess: (data) => router.push(`/teams/${data.id}`),
  });
  async function onSubmit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = createTeamSchema.safeParse({
      name: form.get("name"),
      homeBranchId: branchId,
      headcount: form.get("headcount"),
      contactPhone: form.get("contactPhone"),
      title: form.get("title"),
    });
    const errors = parsed.success ? {} : validationErrors(parsed.error.issues);
    if (branches.length > 0 && !branchId)
      errors.homeBranchId = "주 이용 지점을 선택해 주세요";
    mutation.setErrors(errors);
    if (!parsed.success || Object.keys(errors).length) return;
    await mutation.submit(parsed.data);
  }
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className="space-y-4"
      aria-label="새 팀 만들기"
      aria-busy={mutation.pending}
    >
      <p className="text-sm text-muted-foreground">
        승인 없이 바로 팀이 만들어지고, 내가 팀 관리자가 돼요.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <TeamInput
          label="팀(회사) 이름"
          name="name"
          required
          autoComplete="organization"
          error={mutation.errors.name}
          disabled={mutation.pending}
        />
        {branches.length > 0 ? (
          <BranchSelect
            branches={branches}
            value={branchId}
            onValueChange={setBranchId}
            error={mutation.errors.homeBranchId}
            disabled={mutation.pending}
          />
        ) : (
          <p className="self-center text-sm text-muted-foreground">
            등록된 지점이 없어 주 이용 지점 없이 만들어요.
          </p>
        )}
        <TeamInput
          label="인원 규모"
          name="headcount"
          type="number"
          inputMode="numeric"
          min={1}
          max={1000}
          step={1}
          required
          className="tabular-nums"
          error={mutation.errors.headcount}
          disabled={mutation.pending}
        />
        <TeamInput
          label="담당자 연락처"
          name="contactPhone"
          type="tel"
          autoComplete="tel"
          required
          error={mutation.errors.contactPhone}
          disabled={mutation.pending}
          hint="연락처는 이 팀의 팀 관리자에게만 보여요."
        />
        <TeamInput
          label="직함 (선택)"
          name="title"
          autoComplete="organization-title"
          maxLength={40}
          error={mutation.errors.title}
          disabled={mutation.pending}
        />
      </div>
      <TeamFeedback message={mutation.message} />
      <Button type="submit" disabled={mutation.pending}>
        {mutation.pending ? "처리하고 있어요" : "팀 만들기"}
      </Button>
    </form>
  );
}
