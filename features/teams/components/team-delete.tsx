"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { deleteTeam } from "@/features/teams/manage-actions";
import { normalizeTeamName } from "@/lib/teams/normalize";
import type { TeamDeletePreview } from "../types";
import { TeamFeedback, TeamInput } from "./team-fields";
import { useTeamMutation } from "./use-team-mutation";
import {
  useCloseTeamDialog,
  useTeamDialogIsCurrent,
} from "./team-route-dialog";

export function TeamDelete({
  preview,
  teamName,
}: {
  preview: TeamDeletePreview;
  teamName: string;
}) {
  const close = useCloseTeamDialog(),
    router = useRouter();
  const isCurrent = useTeamDialogIsCurrent();
  const [confirmName, setConfirmName] = useState("");
  const mutation = useTeamMutation({
    action: deleteTeam,
    successMessage: "팀을 지웠어요",
    onSuccess: () => {
      if (
        isCurrent() &&
        window.location.pathname === `/teams/${preview.teamId}`
      )
        router.push("/teams");
    },
  });
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        if (normalizeTeamName(confirmName) === teamName)
          void mutation.submit({ teamId: preview.teamId, confirmName });
      }}
    >
      <ul className="list-inside list-disc space-y-3 text-sm leading-6">
        <li>
          팀원 <span className="tabular-nums">{preview.memberCount}명</span>이
          모두 팀에서 빠지고, 대기 중인 초대{" "}
          <span className="tabular-nums">{preview.inviteCount}건</span>과 가입
          요청 <span className="tabular-nums">{preview.requestCount}건</span>이
          정리돼요
        </li>
        <li>
          앞으로의 팀 예약{" "}
          <span className="tabular-nums">{preview.bookingCount}건</span>이
          취소되고, 예약한 사람과 참석자에게 알림이 가요
        </li>
        <li>팀 스페이스 {teamName}의 채널과 메시지를 아무도 볼 수 없게 돼요</li>
        {preview.accessGrants.length > 0 && (
          <li>
            전용 공간 허용{" "}
            <span className="tabular-nums">
              {preview.accessGrants.length}곳
            </span>
            (
            {preview.accessGrants
              .map((grant) =>
                [grant.branchName, grant.floorName, grant.spaceName]
                  .filter(Boolean)
                  .join(" "),
              )
              .join(", ")}
            )이 풀려요
          </li>
        )}
        <li>지난 예약 기록은 남고, 팀 이름은 ‘지운 팀’으로 보여요</li>
      </ul>
      <TeamInput
        label={`확인하려면 팀 이름 ${teamName}을 입력하세요`}
        value={confirmName}
        onChange={(event) => setConfirmName(event.target.value)}
        disabled={mutation.pending}
        error={mutation.errors.confirmName}
        autoComplete="off"
      />
      <TeamFeedback message={mutation.message} />
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          onClick={close}
          disabled={mutation.pending}
        >
          취소
        </Button>
        <Button
          type="submit"
          variant="destructive"
          disabled={
            mutation.pending || normalizeTeamName(confirmName) !== teamName
          }
        >
          팀 지우기
        </Button>
      </DialogFooter>
    </form>
  );
}
