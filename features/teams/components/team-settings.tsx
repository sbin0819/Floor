"use client";

import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { updateTeam } from "@/features/teams/manage-actions";
import { updateTeamSchema } from "@/features/teams/manage-schema";
import type { TeamPageData } from "../types";
import { teamHref } from "../navigation";
import { BranchSelect, TeamFeedback, TeamInput } from "./team-fields";
import { TeamSection } from "./team-display";
import { useTeamMutation, validationErrors } from "./use-team-mutation";

export function TeamSettings({
  data,
}: {
  data: Extract<TeamPageData, { role: "admin" }>;
}) {
  const initial = () => ({
    name: data.name,
    homeBranchId: data.homeBranchId ?? "",
    headcount: data.headcount?.toString() ?? "",
    contactPhone: data.contactPhone ?? "",
  });
  const [fields, setFields] = useState(initial);
  const mutation = useTeamMutation({
    action: updateTeam,
    successMessage: "팀 정보를 바꿨어요",
  });
  const set = (field: keyof typeof fields, value: string) =>
    setFields((old) => ({ ...old, [field]: value }));
  return (
    <div className="space-y-6">
      <TeamSection title="팀 정보">
        <form
          noValidate
          className="space-y-5"
          onSubmit={async (event) => {
            event.preventDefault();
            const parsed = updateTeamSchema.safeParse({
              teamId: data.id,
              ...fields,
            });
            const errors = parsed.success
              ? {}
              : validationErrors(parsed.error.issues);
            if (data.branches.length && !fields.homeBranchId)
              errors.homeBranchId = "주 이용 지점을 선택해 주세요";
            if (!parsed.success || Object.keys(errors).length) {
              mutation.setErrors(errors);
              return;
            }
            await mutation.submit(parsed.data);
          }}
        >
          <TeamInput
            label="팀 이름"
            value={fields.name}
            onChange={(event) => set("name", event.target.value)}
            maxLength={60}
            disabled={mutation.pending}
            error={mutation.errors.name}
          />
          <div className="grid gap-5 sm:grid-cols-2">
            <BranchSelect
              branches={data.branches}
              value={fields.homeBranchId}
              onValueChange={(value) => set("homeBranchId", value)}
              disabled={mutation.pending || !data.branches.length}
              error={mutation.errors.homeBranchId}
            />
            <TeamInput
              label="인원 규모"
              type="number"
              min={1}
              max={1000}
              value={fields.headcount}
              onChange={(event) => set("headcount", event.target.value)}
              disabled={mutation.pending}
              error={mutation.errors.headcount}
            />
          </div>
          <TeamInput
            label="담당자 연락처"
            type="tel"
            value={fields.contactPhone}
            onChange={(event) => set("contactPhone", event.target.value)}
            disabled={mutation.pending}
            error={mutation.errors.contactPhone}
            hint="연락처는 이 팀의 팀 관리자에게만 보여요."
          />
          <TeamFeedback message={mutation.message} />
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={mutation.pending}
              onClick={() => {
                setFields(initial());
                mutation.setErrors({});
              }}
            >
              되돌리기
            </Button>
            <Button type="submit" disabled={mutation.pending}>
              {mutation.ownPending ? "저장 중…" : "저장"}
            </Button>
          </div>
        </form>
      </TeamSection>
      <section
        className="space-y-4 rounded-xl border border-destructive/30 bg-card p-6"
        aria-label="팀 지우기"
      >
        <h2 className="font-bold">팀 지우기</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          팀원 <span className="tabular-nums">{data.memberCount}명</span>이 모두
          빠지고, 아직 시작하지 않은 팀 예약이 취소되고, 팀 스페이스를 아무도 볼
          수 없게 돼요. 되돌릴 수 없어요. 취소되는 예약 수는 다음 확인 화면에서
          볼 수 있어요.
        </p>
        <Button variant="destructive" asChild>
          <Link
            data-team-delete-trigger
            href={teamHref(data.id, { tab: "settings", dialog: "delete" })}
            scroll={false}
          >
            팀 지우기
          </Link>
        </Button>
      </section>
    </div>
  );
}
