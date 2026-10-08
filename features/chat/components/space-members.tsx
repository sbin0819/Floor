"use client";

import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PersonCard } from "@/features/people/components/person-card";
import type { ActionResult } from "@/lib/actions/result";
import {
  banSpaceMember,
  setSpaceAdmin,
  transferSpaceOwnership,
  unbanSpaceMember,
} from "@/features/chat/space-actions";
import type { SpaceMember, SpaceMembersView } from "../space-members-queries";
import { SpaceConfirm } from "./space-confirm";
import { useSpaceMutation } from "./use-space-mutation";

export function SpaceMembers({
  data,
  currentUserId,
  banned = false,
}: {
  data: SpaceMembersView;
  currentUserId: string;
  banned?: boolean;
}) {
  const headingId = useId();
  if (
    banned &&
    (data.space.kind !== "community" ||
      data.space.role === "member" ||
      data.view !== "full")
  )
    return null;
  const members =
    data.view === "limited" ? data.admins : banned ? data.banned : data.members;
  return (
    <section aria-labelledby={headingId} className="space-y-4">
      <h2 id={headingId} className="text-lg font-bold">
        {banned ? (
          "들어올 수 없는 사람"
        ) : (
          <span>
            멤버 <span className="tabular-nums">{data.memberCount}</span>명
          </span>
        )}
      </h2>
      {data.view === "limited" && (
        <p className="text-sm text-muted-foreground">
          라운지에서는 관리자 목록만 볼 수 있어요
        </p>
      )}
      {members.length ? (
        <ul
          aria-label={
            banned
              ? "들어올 수 없는 사람 목록"
              : data.view === "limited"
                ? "관리자 목록"
                : "멤버 목록"
          }
          className="divide-y divide-border rounded-xl border border-border bg-card"
        >
          {members.map((member) => (
            <li
              key={member.userId}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <PersonCard userId={member.userId} name={member.name}>
                <button
                  type="button"
                  aria-label={`${member.name} 프로필`}
                  className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-semibold"
                  >
                    {Array.from(member.name.trim())[0] ?? "?"}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {member.name}
                    </span>
                    {member.username && (
                      <span className="block truncate text-sm text-muted-foreground">
                        @{member.username}
                      </span>
                    )}
                  </span>
                </button>
              </PersonCard>
              {member.role !== "member" && (
                <Badge variant="outline">
                  {member.role === "owner" ? "소유자" : "관리자"}
                </Badge>
              )}
              <MemberControls
                space={data.space}
                member={member}
                currentUserId={currentUserId}
                banned={banned}
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          {banned
            ? "들어올 수 없는 사람이 없어요"
            : data.view === "limited"
              ? "아직 참여한 관리자가 없어요"
              : "아직 멤버가 없어요"}
        </p>
      )}
    </section>
  );
}

function MemberControls({
  space,
  member,
  currentUserId,
  banned,
}: {
  space: SpaceMembersView["space"];
  member: SpaceMember;
  currentUserId: string;
  banned: boolean;
}) {
  if (space.kind !== "community" || space.role === "member") return null;
  const input = { spaceId: space.id, userId: member.userId };
  if (banned)
    return (
      <MemberAction
        label="풀어 주기"
        action={unbanSpaceMember}
        input={input}
        message="다시 들어올 수 있게 했어요"
      />
    );
  if (
    member.userId.toLowerCase() === currentUserId.toLowerCase() ||
    member.role === "owner"
  )
    return null;
  return (
    <div className="flex flex-wrap gap-2">
      {space.role === "owner" && (
        <>
          <MemberAction
            label={member.role === "admin" ? "관리자 풀기" : "관리자로 정하기"}
            action={setSpaceAdmin}
            input={{ ...input, admin: member.role !== "admin" }}
            message="역할을 바꿨어요"
          />
          <SpaceConfirm
            label="소유권 넘기기"
            title={`${member.name} 님에게 소유권을 넘길까요?`}
            description="이 사람은 소유자가 되고, 나는 관리자가 돼요"
            action={transferSpaceOwnership}
            input={input}
          />
        </>
      )}
      {(space.role === "owner" || member.role === "member") && (
        <SpaceConfirm
          label="내보내기"
          title={`${member.name} 님을 내보낼까요?`}
          description="다시 들어오려면 관리자가 풀어 줘야 해요"
          action={banSpaceMember}
          input={input}
          destructive
        />
      )}
    </div>
  );
}

function MemberAction({
  label,
  action,
  input,
  message,
}: {
  label: string;
  action: (input: unknown) => Promise<ActionResult<unknown>>;
  input: unknown;
  message: string;
}) {
  const mutation = useSpaceMutation(action);
  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button
        variant="outline"
        disabled={mutation.pending}
        onClick={() => void mutation.submit(input, undefined, message)}
      >
        {label}
      </Button>
      {mutation.error && (
        <span role="alert" className="text-xs text-destructive">
          {mutation.error}
        </span>
      )}
    </span>
  );
}
