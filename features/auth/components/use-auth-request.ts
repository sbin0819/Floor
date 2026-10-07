"use client";

import { useRef, useState } from "react";
import type { z } from "zod";
import { authMessages } from "@/features/auth/messages";

export function useAuthRequest() {
  const active = useRef(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function run(
    task: () => Promise<void>,
    failureMessage: string = authMessages.genericError,
  ) {
    if (active.current) return;
    active.current = true;
    setPending(true);
    setMessage("");
    try {
      await task();
    } catch {
      setMessage(failureMessage);
    } finally {
      active.current = false;
      setPending(false);
    }
  }

  return { pending, message, setMessage, run };
}

export function fieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !errors[field])
      errors[field] = issue.message;
  }
  return errors;
}
