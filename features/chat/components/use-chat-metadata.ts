"use client";

import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import type { UserStatus } from "@/features/people/status";
import { CHAT_NAV_KEY, pendingMyStatus } from "../nav-state";
import type { ChatNav } from "../types";

export type ChatMetadata = {
  chatToasts: boolean;
  tabBadge: boolean;
  myStatus: UserStatus;
  blockedUserIds: readonly string[];
};

// 요청은 앱 틀의 ChatNavSync 하나가 맡는다. 초기 미확인은 빈 차단 목록과 다르다.
export function useChatMetadata() {
  const client = useQueryClient();
  const { data } = useQuery<ChatNav & Partial<ChatMetadata>>({
    queryKey: CHAT_NAV_KEY,
    queryFn: skipToken,
    enabled: false,
  });
  return {
    chatToasts: data?.chatToasts,
    tabBadge: data?.tabBadge,
    filesEnabled: data?.filesEnabled ?? false,
    myStatus: data?.myStatus ?? pendingMyStatus(client),
    blockedUserIds: data?.blockedUserIds,
  };
}
