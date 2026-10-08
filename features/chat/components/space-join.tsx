"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { joinSpaceByInvite } from "@/features/chat/space-actions";
import type { SpaceIconColor } from "../space-schema";
import { spaceColorClasses } from "./space-colors";
import { useSpaceMutation } from "./use-space-mutation";

type Preview =
  | { state: "member"; spaceId: string }
  | {
      state: "open";
      spaceName: string;
      iconColor: SpaceIconColor;
      memberCount: number;
    }
  | { state: "invalid" };
export function SpaceJoin({
  code,
  preview,
  action = joinSpaceByInvite,
}: {
  code: string;
  preview: Preview;
  action?: typeof joinSpaceByInvite;
}) {
  const mutation = useSpaceMutation(action),
    router = useRouter();
  return (
    <section className="space-y-5 rounded-xl border border-border bg-card p-6 text-center">
      {preview.state === "member" ? (
        <>
          <h2 className="text-xl font-bold">이미 들어가 있어요</h2>
          <Button asChild>
            <Link href={`/s/${preview.spaceId}`}>열기</Link>
          </Button>
        </>
      ) : preview.state === "invalid" ? (
        <>
          <h2 className="text-xl font-bold">
            초대가 만료됐거나 올바르지 않아요
          </h2>
          <Button asChild variant="outline">
            <Link href="/messages">메시지로 돌아가기</Link>
          </Button>
        </>
      ) : (
        <>
          <span
            aria-hidden="true"
            className={`mx-auto flex size-16 items-center justify-center rounded-xl text-2xl font-bold text-primary-foreground ${spaceColorClasses[preview.iconColor]}`}
          >
            {Array.from(preview.spaceName)[0]}
          </span>
          <h2 className="text-xl font-bold">{preview.spaceName}</h2>
          <p className="text-muted-foreground tabular-nums">
            멤버 {preview.memberCount}명
          </p>
          <Button
            disabled={mutation.pending}
            onClick={() =>
              void mutation.submit(
                { code },
                ({ spaceId }) => router.push(`/s/${spaceId}`),
                "스페이스에 참여했어요",
              )
            }
          >
            참여
          </Button>
        </>
      )}
      {mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error}
        </p>
      )}
    </section>
  );
}
