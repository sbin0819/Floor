"use client";

import { useState, type ReactNode, type SubmitEvent } from "react";
import Link from "next/link";
import { LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { SkeletonRegion } from "@/components/skeleton-region";
import { Skeleton } from "@/components/ui/skeleton";
import { createTeam } from "@/features/teams/create-team-action";
import { createTeamSchema } from "@/features/teams/schema";
import { BranchSelect, TeamFeedback, TeamInput } from "./team-fields";
import { useTeamMutation, validationErrors } from "./use-team-mutation";

export function CreateTeamForm({
  branches,
  branchesPending = false,
  cancel,
}: {
  branches: { id: string; name: string }[];
  branchesPending?: boolean;
  cancel?: ReactNode;
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
    if (branchesPending) return;
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
      className="overflow-hidden rounded-xl border bg-card"
      aria-label="새 팀 만들기"
      aria-busy={mutation.pending}
    >
      <fieldset className="space-y-5 p-5">
        <legend className="float-left w-full font-semibold">팀 정보</legend>
        <TeamInput
          label="팀(회사) 이름"
          name="name"
          required
          autoComplete="organization"
          error={mutation.errors.name}
          disabled={mutation.pending}
          hint="2–40자. 다른 팀과 같은 이름은 쓸 수 없어요."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {branchesPending ? (
            <SkeletonRegion>
              <Skeleton className="h-4 w-24" />
              <Skeleton className="mt-2 h-11 w-full" />
            </SkeletonRegion>
          ) : branches.length > 0 ? (
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
            hint="1–1000명"
          />
        </div>
      </fieldset>
      <fieldset className="space-y-5 border-t p-5">
        <legend className="float-left w-full font-semibold">담당자</legend>
        <div className="grid gap-4 sm:grid-cols-2">
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
            hint="40자 이하로 입력해 주세요."
          />
        </div>
      </fieldset>
      <div className="space-y-4 border-t p-5">
        <TeamFeedback message={mutation.message} />
        <div className="flex justify-end gap-3">
          <Button asChild variant="outline">
            {cancel ?? <Link href="/teams/start">취소</Link>}
          </Button>
          <Button
            type="submit"
            className="min-w-32"
            disabled={mutation.pending || branchesPending}
          >
            {mutation.pending && (
              <LoaderCircle
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none"
              />
            )}
            {mutation.pending ? "만들고 있어요" : "팀 만들기"}
          </Button>
        </div>
      </div>
    </form>
  );
}
