"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { CHAT_NAV_KEY } from "../nav-state";
import type { ChatNav } from "../types";

export function SpaceAccessBoundary({
  spaceId,
  children,
}: {
  spaceId: string;
  children: ReactNode;
}) {
  const client = useQueryClient();
  // 다른 화면에서 보존된 초기 목록만으로 새로 들어온 스페이스를 거절하지 않는다.
  const initial = useMemo(
    () => ({
      spaceId,
      updates: client.getQueryState(CHAT_NAV_KEY)?.dataUpdateCount ?? 0,
    }),
    [client, spaceId],
  );
  const { data } = useQuery<ChatNav>({
    queryKey: CHAT_NAV_KEY,
    queryFn: skipToken,
    enabled: false,
    notifyOnChangeProps: "all",
  });
  const updates = client.getQueryState(CHAT_NAV_KEY)?.dataUpdateCount ?? 0;
  if (
    data &&
    updates > initial.updates &&
    !data.spaces.some((space) => space.id === initial.spaceId)
  )
    return (
      <section className="flex min-h-60 flex-col items-center justify-center gap-4 p-6">
        <p role="status">이 스페이스를 더 볼 수 없어요</p>
        <Link
          href="/messages"
          className="text-primary underline underline-offset-4"
        >
          메시지로 돌아가기
        </Link>
      </section>
    );
  return children;
}
