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
import type { ActionResult } from "@/lib/actions/result";
import { bookingErrorMessage } from "@/features/bookings/ui-errors";

const mutationKey = ["booking-actions"];
const lockedClients = new WeakSet<QueryClient>();

export function useBookingMutation<T>({
  action,
  successMessage,
  onSuccess,
  errorOptions,
}: {
  action: (input: unknown) => Promise<ActionResult<T>>;
  successMessage: string;
  onSuccess?: (data: T) => void;
  errorOptions?: Parameters<typeof bookingErrorMessage>[1];
}) {
  const router = useRouter();
  const client = useQueryClient();
  const pending = useIsMutating({ mutationKey }) > 0;
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});
  const mutation = useMutation({
    mutationKey,
    scope: { id: "booking-actions" },
    retry: false,
    mutationFn: (input: unknown) => action(input),
    onSuccess(result) {
      if (result.ok) {
        toast.success(successMessage);
        onSuccess?.(result.data);
        router.refresh();
      } else {
        const text = bookingErrorMessage(result, errorOptions);
        setMessage(text);
        setFieldErrors(
          result.code === "OVER_CAPACITY"
            ? {
                ...result.fieldErrors,
                [result.message === "participants"
                  ? "participants"
                  : "attendeeCount"]: [text],
              }
            : (result.fieldErrors ?? {}),
        );
        toast.error(text);
        if (
          result.code === "BOOKING_CONFLICT" ||
          result.code === "SPACE_BLOCKED"
        )
          router.refresh();
      }
    },
    onError() {
      const text = bookingErrorMessage({ code: "INTERNAL" });
      setMessage(text);
      toast.error(text);
    },
  });
  async function submit(input: unknown) {
    if (lockedClients.has(client)) return;
    lockedClients.add(client);
    setMessage("");
    setFieldErrors({});
    try {
      await mutation.mutateAsync(input);
    } catch {
      /* 오류 문구는 mutation의 공통 실패 처리에서만 보여 준다. */
    } finally {
      lockedClients.delete(client);
    }
  }
  return { submit, pending, message, fieldErrors };
}
