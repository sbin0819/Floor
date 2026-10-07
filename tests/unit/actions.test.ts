import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";

import { createAction } from "@/lib/actions/create-action";
import { getActionErrorCode, getPostgresError } from "@/lib/actions/errors";
import {
  ActionError,
  type ActionErrorCode,
  type ActionResult,
} from "@/lib/actions/result";
import type { Session } from "@/lib/auth/types";

const session: Session = {
  userId: crypto.randomUUID(),
  name: "데모 사용자",
  email: "demo@example.test",
};
const dependencies = { getSession: async () => session, logError: vi.fn() };

describe("createAction", () => {
  it.each(["per_booking", "per_day", "days_ahead"] as const)(
    "returns a trusted quota reason %s",
    async (message) => {
      const action = createAction(
        {
          input: z.unknown(),
          authorize: "none",
          handler: () => {
            throw new ActionError("LIMIT_EXCEEDED", { message });
          },
        },
        dependencies,
      );
      expect(await action(null)).toEqual({
        ok: false,
        code: "LIMIT_EXCEEDED",
        message,
      });
    },
  );

  it("returns trusted field details but never internal exception details", async () => {
    const action = (error: unknown) =>
      createAction(
        {
          input: z.unknown(),
          authorize: "none",
          handler: () => {
            throw error;
          },
        },
        dependencies,
      );
    expect(
      await action(
        new ActionError("INVALID_INPUT", {
          fieldErrors: { name: ["이미 있는 이름이에요"] },
        }),
      )(null),
    ).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { name: ["이미 있는 이름이에요"] },
    });
    expect(
      await action(
        new ActionError("INTERNAL", {
          fieldErrors: { name: ["private"] },
          message: "per_day",
        }),
      )(null),
    ).toEqual({ ok: false, code: "INTERNAL" });
    expect(
      await action(
        Object.assign(new Error("private"), {
          details: { message: "per_day" },
        }),
      )(null),
    ).toEqual({ ok: false, code: "INTERNAL" });
  });

  it("authenticates, parses, authorizes, and executes in that order", async () => {
    const order: string[] = [];
    const action = createAction(
      {
        input: z.string().transform((value) => {
          order.push("parse");
          return value.length;
        }),
        authorize: ({ session: current, input }) => {
          expectTypeOf(current).toEqualTypeOf<Session>();
          expectTypeOf(input).toEqualTypeOf<number>();
          expect(current).toEqual(session);
          order.push("authorize");
          return true;
        },
        handler: ({ input }) => {
          order.push("handler");
          return input * 2;
        },
      },
      {
        getSession: async () => {
          order.push("session");
          return session;
        },
      },
    );
    expectTypeOf(action).toEqualTypeOf<
      (input: unknown) => Promise<ActionResult<number>>
    >();
    await expect(action("floor")).resolves.toEqual({ ok: true, data: 10 });
    expect(order).toEqual(["session", "parse", "authorize", "handler"]);
  });

  it("rejects a missing session before parsing or running callbacks", async () => {
    const parse = vi.fn(() => true);
    const authorize = vi.fn(() => true);
    const handler = vi.fn();
    const action = createAction(
      { input: z.unknown().refine(parse), authorize, handler },
      { getSession: async () => null },
    );
    await expect(action({})).resolves.toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(parse).not.toHaveBeenCalled();
    expect(authorize).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("requires an explicit public mode and provides a nullable session", async () => {
    const action = createAction(
      {
        auth: "public",
        input: z.string(),
        authorize: "none",
        handler: ({ session: current, input }) => {
          expectTypeOf(current).toEqualTypeOf<Session | null>();
          return { anonymous: current === null, input };
        },
      },
      { getSession: async () => null },
    );
    await expect(action("demo")).resolves.toEqual({
      ok: true,
      data: { anonymous: true, input: "demo" },
    });
  });

  it("requires an explicit authorization choice at compile time", () => {
    // 권한 확인을 누락한 액션은 타입 검사 단계에서 거절해야 해요.
    // @ts-expect-error authorize는 필수 계약이에요.
    createAction({ input: z.string(), handler: () => null });
  });

  it("returns field errors and never authorizes invalid input", async () => {
    const authorize = vi.fn(() => true);
    const handler = vi.fn();
    const action = createAction(
      { input: z.object({ bookingId: z.uuid() }), authorize, handler },
      dependencies,
    );
    const result = await action({ bookingId: "not-a-uuid" });
    expect(result).toMatchObject({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { bookingId: [expect.any(String)] },
    });
    expect(authorize).not.toHaveBeenCalled();
    expect(handler).not.toHaveBeenCalled();
  });

  it("includes root and nested validation errors", async () => {
    const action = createAction(
      {
        input: z.object({ booking: z.object({ id: z.uuid() }) }),
        authorize: "none",
        handler: () => null,
      },
      dependencies,
    );
    await expect(action(null)).resolves.toMatchObject({
      code: "INVALID_INPUT",
      fieldErrors: { _root: [expect.any(String)] },
    });
    await expect(action({ booking: { id: "" } })).resolves.toMatchObject({
      code: "INVALID_INPUT",
      fieldErrors: { "booking.id": [expect.any(String)] },
    });
  });

  it.each(["toString", "constructor"])(
    "returns validation errors for the inherited property name %s",
    async (key) => {
      const logError = vi.fn();
      const action = createAction(
        {
          input: z.record(z.string(), z.number()),
          authorize: "none",
          handler: () => null,
        },
        { ...dependencies, logError },
      );

      await expect(action({ [key]: "invalid" })).resolves.toEqual({
        ok: false,
        code: "INVALID_INPUT",
        fieldErrors: { [key]: [expect.any(String)] },
      });
      expect(logError).not.toHaveBeenCalled();
    },
  );

  it("stores __proto__ issue paths as own data properties and preserves repeated errors", async () => {
    const action = createAction(
      {
        input: z.unknown().superRefine((_value, context) => {
          context.addIssue({
            code: "custom",
            path: ["__proto__"],
            message: "first error",
          });
          context.addIssue({
            code: "custom",
            path: ["__proto__"],
            message: "second error",
          });
        }),
        authorize: "none",
        handler: () => null,
      },
      dependencies,
    );

    const result = await action(null);
    expect(result).toEqual({
      ok: false,
      code: "INVALID_INPUT",
      fieldErrors: { ["__proto__"]: ["first error", "second error"] },
    });
    if (result.ok || !result.fieldErrors)
      throw new Error("Expected field validation errors");
    expect(Object.hasOwn(result.fieldErrors, "__proto__")).toBe(true);
    expect(Object.getPrototypeOf(result.fieldErrors)).toBe(Object.prototype);
  });

  it("blocks the handler when authorization fails", async () => {
    const handler = vi.fn();
    const action = createAction(
      { input: z.string(), authorize: () => false, handler },
      dependencies,
    );
    await expect(action("floor")).resolves.toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it("also runs authorization on public actions", async () => {
    const handler = vi.fn();
    const action = createAction(
      { auth: "public", input: z.string(), authorize: () => false, handler },
      { getSession: async () => null },
    );
    await expect(action("floor")).resolves.toEqual({
      ok: false,
      code: "FORBIDDEN",
    });
    expect(handler).not.toHaveBeenCalled();
  });

  it.each(["authorize", "handler"] as const)(
    "maps domain errors thrown by %s",
    async (stage) => {
      const action = createAction(
        {
          input: z.string(),
          authorize: () => {
            if (stage === "authorize") throw new ActionError("NOT_FOUND");
            return true;
          },
          handler: () => {
            throw new ActionError("SPACE_BLOCKED");
          },
        },
        dependencies,
      );
      await expect(action("floor")).resolves.toEqual({
        ok: false,
        code: stage === "authorize" ? "NOT_FOUND" : "SPACE_BLOCKED",
      });
    },
  );

  it("logs unknown errors without exposing their message, query, or stack", async () => {
    const error = new Error("private database connection and SQL details");
    const logError = vi.fn();
    const action = createAction(
      {
        input: z.string(),
        authorize: "none",
        handler: () => {
          throw error;
        },
      },
      { ...dependencies, logError },
    );
    await expect(action("floor")).resolves.toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(logError).toHaveBeenCalledExactlyOnceWith(error);
  });

  it("maps errors from session loading without rejecting the action promise", async () => {
    const logError = vi.fn();
    const action = createAction(
      { input: z.string(), authorize: "none", handler: () => "unreachable" },
      {
        getSession: async () => {
          throw new Error("session database unavailable");
        },
        logError,
      },
    );
    await expect(action("floor")).resolves.toEqual({
      ok: false,
      code: "INTERNAL",
    });
    expect(logError).toHaveBeenCalledOnce();
  });

  it("never logs raw SQL, invitation tokens, email, or contact details by default", async () => {
    const output = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const action = createAction(
        {
          input: z.string(),
          authorize: "none",
          handler: () => {
            throw new Error(
              "SQL token=private-invite recipient@example.test 01012345678",
            );
          },
        },
        { getSession: async () => session },
      );
      await expect(action("valid")).resolves.toEqual({
        ok: false,
        code: "INTERNAL",
      });
      expect(output).toHaveBeenCalledExactlyOnceWith("Server action failed.");
    } finally {
      output.mockRestore();
    }
  });
});

describe("getActionErrorCode", () => {
  it.each<ActionErrorCode>([
    "UNAUTHENTICATED",
    "FORBIDDEN",
    "INVALID_INPUT",
    "NOT_FOUND",
    "BOOKING_CONFLICT",
    "SPACE_BLOCKED",
    "LIMIT_EXCEEDED",
    "PLAN_INVALID",
    "TEAM_NAME_TAKEN",
    "ALREADY_MEMBER",
    "ALREADY_REQUESTED",
    "INVITE_INVALID",
    "INTERNAL",
  ])("preserves %s domain errors", (code) => {
    expect(getActionErrorCode(new ActionError(code))).toBe(code);
  });

  it("finds PostgreSQL exclusion errors inside the Drizzle cause chain", () => {
    expect(
      getActionErrorCode(
        new Error("query failed", {
          cause: new Error("driver wrapper", { cause: { code: "23P01" } }),
        }),
      ),
    ).toBe("BOOKING_CONFLICT");
    expect(getActionErrorCode({ code: "23505" })).toBe("INTERNAL");
  });

  it("terminates on circular causes and handles primitive thrown values", () => {
    const error = { cause: {} };
    error.cause = error;
    expect(getActionErrorCode(error)).toBe("INTERNAL");
    expect(getActionErrorCode(null)).toBe("INTERNAL");
    expect(getActionErrorCode("failure")).toBe("INTERNAL");
  });

  it.each([
    ["teams_name_unique", "TEAM_NAME_TAKEN"],
    ["team_join_requests_one_pending", "ALREADY_REQUESTED"],
    ["team_invites_one_pending", "INTERNAL"],
    ["unknown", "INTERNAL"],
  ])(
    "maps only the allowlisted unique constraint %s",
    (constraint, expected) => {
      const error = new Error("sensitive SQL", {
        cause: { cause: { code: "23505", constraint } },
      });
      expect(getActionErrorCode(error)).toBe(expected);
      expect(getPostgresError(error)).toEqual({ code: "23505", constraint });
    },
  );
  it("does not map constraint names without a matching SQLSTATE", () => {
    expect(
      getActionErrorCode({ code: "23503", constraint: "teams_name_unique" }),
    ).toBe("INTERNAL");
    expect(getPostgresError(new Error("23505 teams_name_unique"))).toBeNull();
  });
});
