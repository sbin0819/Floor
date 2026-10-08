"use client";

import { Button } from "@/components/ui/button";
import type { SpaceInviteItem } from "../space-invite-queries";
import { revokeInvite } from "@/features/chat/space-actions";
import { useSpaceMutation } from "./use-space-mutation";

export function SpaceInvitesList({ rows }: { rows: SpaceInviteItem[] }) {
  const mutation = useSpaceMutation(revokeInvite);
  return (
    <section className="space-y-3">
      <h2 className="text-lg font-bold">사용할 수 있는 초대 링크</h2>
      {rows.length ? (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {rows.map((row) => (
            <li
              key={row.inviteId}
              className="flex flex-wrap items-center justify-between gap-3 p-4"
            >
              <div className="space-y-1">
                <p className="font-semibold">
                  {row.codePrefix}… · {row.createdByName}
                </p>
                <p className="text-sm text-muted-foreground tabular-nums">
                  사용 {row.useCount} / {row.maxUses ?? "제한 없음"} ·{" "}
                  {row.expiresAt
                    ? `만료 ${row.expiresAt.slice(0, 10)}`
                    : "만료 없음"}
                </p>
                {row.code && (
                  <p className="text-xs break-all text-muted-foreground">
                    /s/join/{row.code}
                  </p>
                )}
              </div>
              <Button
                variant="outline"
                disabled={mutation.pending}
                onClick={() =>
                  void mutation.submit(
                    { inviteId: row.inviteId },
                    undefined,
                    "초대 링크를 끊었어요",
                  )
                }
              >
                끊기
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">
          사용할 수 있는 초대 링크가 없어요
        </p>
      )}
      {mutation.error && (
        <p role="alert" className="text-sm text-destructive">
          {mutation.error}
        </p>
      )}
    </section>
  );
}
