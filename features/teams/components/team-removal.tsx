"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { DialogFooter } from "@/components/ui/dialog";
import { removeMember, leaveTeam } from "@/features/teams/manage-actions";
import {
  formatBookingDate,
  formatBookingTime,
} from "@/features/bookings/format";
import { localDate } from "@/lib/time/zoned";
import type { TeamRemovalPreview } from "../types";
import { TeamFeedback } from "./team-fields";
import { useTeamMutation } from "./use-team-mutation";
import {
  useCloseTeamDialog,
  useTeamDialogIsCurrent,
} from "./team-route-dialog";

export function TeamRemoval({
  preview,
  teamName,
  name,
  leaving,
}: {
  preview: TeamRemovalPreview;
  teamName: string;
  name: string;
  leaving: boolean;
}) {
  const close = useCloseTeamDialog(),
    router = useRouter();
  const isCurrent = useTeamDialogIsCurrent();
  const mutation = useTeamMutation({
    action: leaving ? leaveTeam : removeMember,
    successMessage: leaving
      ? `${teamName}에서 나왔어요`
      : `${name} 님을 팀에서 내보냈어요`,
    onSuccess: () => {
      if (
        !isCurrent() ||
        window.location.pathname !== `/teams/${preview.teamId}`
      )
        return;
      if (leaving) router.push("/teams");
      else close();
    },
  });
  const first = preview.firstBooking;
  return (
    <div className="space-y-5">
      <ul className="list-inside list-disc space-y-3 text-sm leading-6">
        <li>팀 스페이스 {teamName}과 팀 전용 공간을 더 이상 쓸 수 없어요</li>
        {preview.bookingCount > 0 && (
          <li>
            {leaving ? "내가" : `${name} 님이`} 팀 이름으로 잡은 앞으로의 예약{" "}
            <span className="tabular-nums">{preview.bookingCount}건</span>이
            취소돼요
            {first && (
              <p className="pl-4 text-xs text-muted-foreground tabular-nums">
                {formatBookingDate(
                  localDate(new Date(first.startAt), first.timezone),
                  first.timezone,
                )}{" "}
                {formatBookingTime(first.startAt, first.endAt, first.timezone)}{" "}
                · {first.spaceName}
              </p>
            )}
          </li>
        )}
        <li>
          {leaving
            ? "취소된 예약의 참석자에게"
            : `${name} 님과 그 예약의 참석자에게`}{" "}
          알림이 가요
        </li>
      </ul>
      <TeamFeedback message={mutation.message} />
      <DialogFooter>
        <Button variant="outline" disabled={mutation.pending} onClick={close}>
          취소
        </Button>
        <Button
          variant="destructive"
          disabled={mutation.pending}
          onClick={() =>
            void mutation.submit(
              leaving
                ? { teamId: preview.teamId }
                : { teamId: preview.teamId, userId: preview.userId },
            )
          }
        >
          {leaving ? "나가기" : "내보내기"}
        </Button>
      </DialogFooter>
    </div>
  );
}
