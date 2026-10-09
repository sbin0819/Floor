import { z } from "zod";

import { getActionErrorCode } from "@/lib/actions/errors";
import { ActionError, type ActionResult } from "@/lib/actions/result";
import { getSession } from "@/lib/auth/session";
import type { Session } from "@/lib/auth/types";

type MaybePromise<T> = T | Promise<T>;
type ActionContext<Input, CurrentSession> = {
  session: CurrentSession;
  input: Input;
};

type ActionOptions<Input, Output, CurrentSession> = {
  input: z.ZodType<Input>;
  authorize:
    | "none"
    | ((
        context: ActionContext<Input, CurrentSession>,
      ) => MaybePromise<boolean>);
  handler: (
    context: ActionContext<Input, CurrentSession>,
  ) => MaybePromise<Output>;
};

type RequiredActionOptions<Input, Output> = ActionOptions<
  Input,
  Output,
  Session
> & {
  auth?: "required";
};

type PublicActionOptions<Input, Output> = ActionOptions<
  Input,
  Output,
  Session | null
> & {
  auth: "public";
};

export type ActionDependencies = {
  getSession: () => Promise<Session | null>;
  logError: (error: unknown) => void;
};

const defaultDependencies: ActionDependencies = {
  getSession,
  logError: () => console.error("Server action failed."),
};

export function createAction<Input, Output>(
  options: PublicActionOptions<Input, Output>,
  dependencies?: Partial<ActionDependencies>,
): (input: unknown) => Promise<ActionResult<Output>>;
export function createAction<Input, Output>(
  options: RequiredActionOptions<Input, Output>,
  dependencies?: Partial<ActionDependencies>,
): (input: unknown) => Promise<ActionResult<Output>>;
export function createAction<Input, Output>(
  options:
    PublicActionOptions<Input, Output> | RequiredActionOptions<Input, Output>,
  dependencies: Partial<ActionDependencies> = {},
): (input: unknown) => Promise<ActionResult<Output>> {
  const { getSession: readSession, logError } = {
    ...defaultDependencies,
    ...dependencies,
  };

  return async (input) => {
    try {
      const session = await readSession();
      if (options.auth !== "public" && !session) {
        return { ok: false, code: "UNAUTHENTICATED" };
      }

      const parsed = await options.input.safeParseAsync(input);
      if (!parsed.success) {
        const errorsByField = new Map<string, string[]>();
        for (const issue of parsed.error.issues) {
          const key = issue.path.map(String).join(".") || "_root";
          errorsByField.set(key, [
            ...(errorsByField.get(key) ?? []),
            issue.message,
          ]);
        }
        return {
          ok: false,
          code: "INVALID_INPUT",
          fieldErrors: Object.fromEntries(errorsByField),
        };
      }

      if (options.auth === "public") {
        const context = { session, input: parsed.data };
        if (
          options.authorize !== "none" &&
          !(await options.authorize(context))
        ) {
          return { ok: false, code: "FORBIDDEN" };
        }
        return { ok: true, data: await options.handler(context) };
      }

      if (!session) return { ok: false, code: "UNAUTHENTICATED" };
      const context = { session, input: parsed.data };
      if (options.authorize !== "none" && !(await options.authorize(context))) {
        return { ok: false, code: "FORBIDDEN" };
      }
      return { ok: true, data: await options.handler(context) };
    } catch (error) {
      const code = getActionErrorCode(error);
      if (code === "INTERNAL") logError(error);
      return {
        ok: false,
        code,
        ...(error instanceof ActionError &&
        ((code === "LIMIT_EXCEEDED" &&
          [
            "per_booking",
            "per_day",
            "days_ahead",
            "desk_per_person",
            "send_rate",
            "reaction_rate",
            "username_cooldown",
            "friend_daily",
            "friend_cooldown",
            "report_daily",
            "request_daily",
            "request_pending",
            "space_count",
            "space_join_count",
            "invite_count",
            "channel_count",
            "space_full",
            "call_full",
            "storage_quota",
            "password_attempts",
            "admin_teams",
            "announce_daily",
            "announce_recipients",
          ].includes(error.details.message ?? "")) ||
          (code === "INVALID_INPUT" &&
            [
              "not_cancellable",
              "maintenance_state",
              "lounge_unavailable",
            ].includes(error.details.message ?? "")) ||
          (code === "FORBIDDEN" &&
            error.details.message === "files_disabled") ||
          (code === "OVER_CAPACITY" &&
            ["attendee_count", "participants"].includes(
              error.details.message ?? "",
            )))
          ? { message: error.details.message }
          : {}),
        ...(error instanceof ActionError &&
        code === "INVALID_INPUT" &&
        error.details.fieldErrors
          ? { fieldErrors: error.details.fieldErrors }
          : {}),
        ...(error instanceof ActionError &&
        code === "PLAN_INVALID" &&
        error.details.issues
          ? { issues: error.details.issues }
          : {}),
      };
    }
  };
}
