"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/actions/result";

export function peopleError(result: { code: string; message?: string }) {
  if (result.message === "friend_daily")
    return "오늘은 친구 요청을 더 보낼 수 없어요";
  if (result.message === "friend_cooldown")
    return "취소한 요청은 하루 뒤에 다시 보낼 수 있어요";
  if (result.code === "FORBIDDEN") return "친구 요청을 보낼 수 없어요";
  if (result.code === "UNAUTHENTICATED")
    return "로그인이 필요해요. 다시 로그인해 주세요";
  if (result.code === "NOT_FOUND")
    return "이미 처리됐거나 찾을 수 없는 항목이에요";
  return "처리하지 못했어요. 다시 시도해 주세요";
}

export function usePeopleMutation<T>(
  action: (input: unknown) => Promise<ActionResult<T>>,
  sharedLock?: RefObject<boolean>,
  errorText: (result: {
    code: string;
    message?: string;
  }) => string = peopleError,
) {
  const client = useQueryClient();
  const router = useRouter();
  const ownLock = useRef(false);
  const locked = sharedLock ?? ownLock;
  const active = useRef({ current: true });
  useEffect(() => {
    const scope = { current: true };
    active.current = scope;
    return () => {
      scope.current = false;
    };
  }, []);
  const mutation = useMutation({
    mutationFn: (input: unknown) => action(input),
    retry: false,
  });
  async function run(input: unknown, success: string | ((data: T) => string)) {
    if (locked.current) return;
    locked.current = true;
    const scope = active.current;
    try {
      const result = await mutation.mutateAsync(input);
      if (!scope.current) return;
      if (!result.ok) {
        toast.error(errorText(result));
        return;
      }
      const message =
        typeof success === "function" ? success(result.data) : success;
      if (message) toast.success(message);
      void client.invalidateQueries({ queryKey: ["people"] });
      void client.invalidateQueries({ queryKey: ["chat", "nav"] });
      router.refresh();
      return result;
    } catch {
      if (scope.current) toast.error("처리하지 못했어요. 다시 시도해 주세요");
    } finally {
      locked.current = false;
    }
  }
  return { run, pending: mutation.isPending };
}
