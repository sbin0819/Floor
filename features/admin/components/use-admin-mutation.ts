"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  useIsMutating,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { toast } from "sonner";
import type { z } from "zod";
import type { ActionErrorCode, ActionResult } from "@/lib/actions/result";
import { errorMessage } from "@/lib/errors/messages";
import { notifySessionExpired } from "@/lib/errors/session-expired";
import { isRequestCanceled } from "@/lib/http/errors";

const mutationKey = ["admin-actions"];
const locks = new WeakSet<QueryClient>();
export function adminErrorMessage(code: ActionErrorCode) {
  switch (code) {
    case "SPACE_IN_USE":
      return "예정된 예약이 있어서 바꿀 수 없어요. 예약이 끝나거나 취소된 뒤에 다시 해 주세요";
    case "NOT_FOUND":
      return "찾을 수 없는 항목이에요. 새로고침해 주세요";
    default:
      return errorMessage(
        { code },
        "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요",
      );
  }
}
export function useAdminMutation<T>({
  action,
  onSuccess,
  successMessage = "저장했어요",
}: {
  action: (input: unknown) => Promise<ActionResult<T>>;
  onSuccess?: (data: T) => void;
  successMessage?: string | ((data: T) => string);
}) {
  const client = useQueryClient();
  const router = useRouter();
  const pending = useIsMutating({ mutationKey }) > 0;
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationKey,
    scope: { id: "admin-actions" },
    retry: false,
    mutationFn: (input: unknown) => action(input),
    onSuccess(result) {
      if (!result.ok) {
        const text =
          result.message === "not_cancellable"
            ? "이미 끝났거나 취소된 예약이에요. 다시 확인해 주세요"
            : adminErrorMessage(result.code);
        setMessage(text);
        setErrors(
          Object.fromEntries(
            Object.entries(result.fieldErrors ?? {}).map(([key, values]) => [
              key,
              values[0] ?? text,
            ]),
          ),
        );
        if (!notifySessionExpired(client, result)) toast.error(text);
        if (result.message === "not_cancellable") router.refresh();
        return;
      }
      toast.success(
        typeof successMessage === "function"
          ? successMessage(result.data)
          : successMessage,
      );
      onSuccess?.(result.data);
      router.refresh();
    },
    onError(error) {
      if (isRequestCanceled(error)) return;
      const text = errorMessage(error, adminErrorMessage("INTERNAL"));
      setMessage(text);
      if (!notifySessionExpired(client, error)) toast.error(text);
    },
  });
  async function submit(schema: z.ZodType, input: unknown) {
    if (locks.has(client)) return;
    const parsed = schema.safeParse(input);
    setMessage("");
    setErrors({});
    if (!parsed.success) {
      const next: Record<string, string> = {};
      for (const issue of parsed.error.issues)
        next[issue.path.join(".") || "form"] ??= issue.message;
      setErrors(next);
      setMessage("입력한 내용을 확인해 주세요");
      return;
    }
    locks.add(client);
    try {
      // 변환 스키마는 서버에서 다시 실행되므로 원래 입력을 보내요.
      await mutation.mutateAsync(input);
    } catch {
      /* 공통 실패 처리에서 표시해요. */
    } finally {
      locks.delete(client);
    }
  }
  return { submit, pending, errors, message };
}
