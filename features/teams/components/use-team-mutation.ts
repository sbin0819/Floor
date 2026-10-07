"use client";

import {
  useIsMutating,
  useMutation,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { ActionErrorCode, ActionResult } from "@/lib/actions/result";

const mutationKey = ["team-actions"];
const lockedClients = new WeakSet<QueryClient>();
const fallbackMessage = "처리하지 못했어요. 새로고침한 뒤 다시 시도해 주세요";

export function teamErrorMessage(code: ActionErrorCode, limitMessage?: string) {
  switch (code) {
    case "TEAM_NAME_TAKEN":
      return "같은 이름의 팀이 이미 있어요";
    case "ALREADY_MEMBER":
      return "이미 팀원이에요";
    case "ALREADY_REQUESTED":
      return "이미 보낸 가입 요청이 있어요";
    case "INVITE_INVALID":
      return "이 초대는 더 이상 쓸 수 없어요";
    case "LIMIT_EXCEEDED":
      return (
        limitMessage ??
        "대기 중인 항목이 너무 많아요. 기존 항목을 정리한 뒤 다시 시도해 주세요"
      );
    case "FORBIDDEN":
      return "이 작업을 할 권한이 없어요";
    case "UNAUTHENTICATED":
      return "로그인이 필요해요. 다시 로그인해 주세요";
    case "INVALID_INPUT":
      return "입력한 내용을 확인해 주세요";
    case "NOT_FOUND":
      return "이미 처리됐거나 찾을 수 없는 항목이에요";
    default:
      return fallbackMessage;
  }
}

export function useTeamMutation<T>({
  action,
  successMessage,
  limitMessage,
  onStart,
  onSuccess,
}: {
  action: (input: unknown) => Promise<ActionResult<T>>;
  successMessage: string;
  limitMessage?: string;
  onStart?: () => void;
  onSuccess?: (data: T) => void;
}) {
  const client = useQueryClient();
  const router = useRouter();
  const pending = useIsMutating({ mutationKey }) > 0;
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const mutation = useMutation({
    mutationKey,
    mutationFn: (input: unknown) => action(input),
    scope: { id: "team-actions" },
    retry: false,
  });

  async function submit(input: unknown) {
    // React가 비활성 상태를 그리기 전의 연속 클릭과 다른 양식의 제출도 막아요.
    if (lockedClients.has(client)) return;
    lockedClients.add(client);
    setMessage("");
    setErrors({});
    try {
      onStart?.();
      const result = await mutation.mutateAsync(input);
      if (!result.ok) {
        const text = teamErrorMessage(result.code, limitMessage);
        setMessage(text);
        setErrors(
          Object.fromEntries(
            Object.entries(result.fieldErrors ?? {}).map(([key, values]) => [
              key,
              values[0] ?? "입력한 내용을 확인해 주세요",
            ]),
          ),
        );
        toast.error(text);
        return;
      }
      toast.success(successMessage);
      onSuccess?.(result.data);
      router.refresh();
      return result.data;
    } catch {
      setMessage(fallbackMessage);
      toast.error(fallbackMessage);
    } finally {
      lockedClients.delete(client);
    }
  }
  return {
    submit,
    pending,
    ownPending: mutation.isPending,
    message,
    errors,
    setErrors,
  };
}

export function validationErrors(
  issues: { path: PropertyKey[]; message: string }[],
) {
  const result: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? "form");
    result[key] ??= issue.message;
  }
  return result;
}
