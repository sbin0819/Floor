"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/lib/actions/result";
import { CHAT_NAV_KEY } from "../nav-state";

export function spaceActionMessage(
  result: Extract<ActionResult<unknown>, { ok: false }>,
) {
  if (result.code === "LIMIT_EXCEEDED") {
    switch (result.message) {
      case "space_count":
        return "스페이스는 10개까지 만들 수 있어요";
      case "space_join_count":
        return "스페이스에는 100개까지 들어갈 수 있어요";
      case "invite_count":
        return "오늘은 초대를 더 만들 수 없어요";
      case "channel_count":
        return "채널은 50개까지 만들 수 있어요";
      case "space_full":
        return "이 스페이스는 꽉 찼어요";
      default:
        return "잠시 뒤에 다시 해 주세요";
    }
  }
  switch (result.code) {
    case "CHANNEL_NAME_TAKEN":
      return "같은 이름의 채널이 있어요";
    case "INVITE_INVALID":
      return "초대가 만료됐거나 올바르지 않아요";
    case "NOT_FOUND":
      return "이미 처리됐거나 더 볼 수 없는 항목이에요";
    case "FORBIDDEN":
      return "이 작업을 할 수 없어요";
    case "INVALID_INPUT":
      return "입력한 내용을 확인해 주세요";
    case "UNAUTHENTICATED":
      return "다시 로그인해 주세요";
    default:
      return "처리하지 못했어요. 다시 시도해 주세요";
  }
}

export function useSpaceMutation<T>(
  action: (input: unknown) => Promise<ActionResult<T>>,
) {
  const router = useRouter();
  const client = useQueryClient();
  const locked = useRef(false);
  const lifetime = useRef({ active: true });
  const [error, setError] = useState("");
  useEffect(() => {
    const current = { active: true };
    lifetime.current = current;
    return () => {
      current.active = false;
    };
  }, []);
  const mutation = useMutation({
    mutationFn: (input: unknown) => action(input),
    scope: { id: "space-actions" },
    retry: false,
  });
  async function submit(
    input: unknown,
    success?: (data: T) => void,
    message?: string,
  ) {
    if (locked.current) return;
    locked.current = true;
    const current = lifetime.current;
    setError("");
    try {
      const result = await mutation.mutateAsync(input);
      if (!current.active) return;
      if (!result.ok) {
        setError(spaceActionMessage(result));
        return;
      }
      void client.invalidateQueries({ queryKey: CHAT_NAV_KEY });
      success?.(result.data);
      if (message) toast.success(message);
      router.refresh();
      return result.data;
    } catch {
      if (current.active) setError("처리하지 못했어요. 다시 시도해 주세요");
    } finally {
      locked.current = false;
    }
  }
  return { submit, pending: mutation.isPending, error };
}
