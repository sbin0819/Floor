import { afterEach, describe, expect, it, vi } from "vitest";
import { createSettingsActions } from "@/features/settings/action-factory";
import { ActionError } from "@/lib/actions/result";
import type { createAccountSecurity } from "@/lib/auth/account-security";
import { createMemoryRateLimiter } from "@/lib/rate-limit/memory";
import { userChannel } from "@/lib/realtime/channels";

type Security = ReturnType<typeof createAccountSecurity>;
const userId = "d1000000-0000-4000-8000-000000000001";
const sessionId = "d1000000-0000-4000-8000-000000000002";
const session = { userId, name: "회원", email: "member@example.com" };
const password = {
  currentPassword: "current-password",
  newPassword: "different-password",
  confirmPassword: "different-password",
  revokeOtherSessions: true,
};
function setup() {
  let clock = 0;
  const security = {
    changeMyPassword: vi.fn<Security["changeMyPassword"]>().mockResolvedValue(),
    listMySessions: vi.fn<Security["listMySessions"]>().mockResolvedValue([]),
    listMyProviders: vi
      .fn<Security["listMyProviders"]>()
      .mockResolvedValue(["credential"]),
    revokeMySession: vi.fn<Security["revokeMySession"]>().mockResolvedValue(),
    revokeMyOtherSessions: vi
      .fn<Security["revokeMyOtherSessions"]>()
      .mockResolvedValue(),
  };
  const limiter = createMemoryRateLimiter(() => clock);
  const consume = vi.spyOn(limiter, "consume");
  const getSession = vi.fn().mockResolvedValue(session);
  const publisher = {
    publish: vi.fn().mockResolvedValue(undefined),
    publishMany: vi.fn().mockResolvedValue(undefined),
  };
  const logError = vi.fn();
  const actions = createSettingsActions({
    security,
    limiter,
    getSession,
    publisher,
    logError,
  });
  return {
    actions,
    security,
    consume,
    getSession,
    publisher,
    logError,
    advance: (milliseconds: number) => {
      clock += milliseconds;
    },
  };
}
afterEach(() => vi.restoreAllMocks());

describe("settings action security boundary", () => {
  it.each([
    "updateName",
    "updateAvatar",
    "changePassword",
    "revokeSession",
    "revokeOtherSessions",
    "updatePreferences",
  ] as const)("checks session before parsing %s", async (name) => {
    const state = setup();
    state.getSession.mockResolvedValue(null);
    expect(await state.actions[name](null)).toEqual({
      ok: false,
      code: "UNAUTHENTICATED",
    });
    expect(state.consume).not.toHaveBeenCalled();
    for (const method of Object.values(state.security))
      expect(method).not.toHaveBeenCalled();
  });

  it.each([
    [{ currentPassword: "" }, "currentPassword"],
    [{ currentPassword: "x".repeat(129) }, "currentPassword"],
    [{ newPassword: "1234567", confirmPassword: "1234567" }, "newPassword"],
    [
      { newPassword: "x".repeat(129), confirmPassword: "x".repeat(129) },
      "newPassword",
    ],
    [{ confirmPassword: "not-the-password" }, "confirmPassword"],
    [
      {
        newPassword: password.currentPassword,
        confirmPassword: password.currentPassword,
      },
      "newPassword",
    ],
    [{ revokeOtherSessions: "true" }, "revokeOtherSessions"],
    [{ userId: sessionId }, "_root"],
  ] as const)(
    "validates password input before consuming attempts: %j",
    async (values, field) => {
      const state = setup();
      const result = await state.actions.changePassword({
        ...password,
        ...values,
      });
      expect(result).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
        fieldErrors: { [field]: expect.any(Array) },
      });
      expect(state.consume).not.toHaveBeenCalled();
      expect(state.security.changeMyPassword).not.toHaveBeenCalled();
      expect(state.publisher.publish).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toContain(password.currentPassword);
    },
  );

  it("passes only the validated password fields and publishes reauthentication after success", async () => {
    const state = setup();
    expect(await state.actions.changePassword(password)).toEqual({
      ok: true,
      data: {},
    });
    expect(state.consume).toHaveBeenCalledExactlyOnceWith(
      `password:${userId}`,
      5,
      600_000,
    );
    expect(state.security.changeMyPassword).toHaveBeenCalledExactlyOnceWith({
      currentPassword: password.currentPassword,
      newPassword: password.newPassword,
      revokeOtherSessions: true,
    });
    expect(state.publisher.publish).toHaveBeenCalledExactlyOnceWith(
      userChannel(userId),
      { type: "realtime.reauth" },
    );
    expect(
      state.security.changeMyPassword.mock.invocationCallOrder[0],
    ).toBeLessThan(state.publisher.publish.mock.invocationCallOrder[0]!);
  });

  it("counts failed attempts per user and opens a new window at exactly ten minutes", async () => {
    const state = setup();
    state.security.changeMyPassword.mockRejectedValue(
      new ActionError("PASSWORD_INCORRECT"),
    );
    for (let index = 0; index < 5; index++)
      expect(await state.actions.changePassword(password)).toEqual({
        ok: false,
        code: "PASSWORD_INCORRECT",
      });
    expect(await state.actions.changePassword(password)).toEqual({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "password_attempts",
    });
    expect(state.security.changeMyPassword).toHaveBeenCalledTimes(5);
    state.getSession.mockResolvedValue({ ...session, userId: sessionId });
    expect(await state.actions.changePassword(password)).toEqual({
      ok: false,
      code: "PASSWORD_INCORRECT",
    });
    state.getSession.mockResolvedValue(session);
    state.advance(599_999);
    expect(await state.actions.changePassword(password)).toMatchObject({
      code: "LIMIT_EXCEEDED",
    });
    state.advance(1);
    expect(await state.actions.changePassword(password)).toEqual({
      ok: false,
      code: "PASSWORD_INCORRECT",
    });
    expect(state.publisher.publish).not.toHaveBeenCalled();
    expect(state.logError).not.toHaveBeenCalled();
  });

  it.each(["PASSWORD_INCORRECT", "FORBIDDEN", "UNAUTHENTICATED"] as const)(
    "returns safe %s without publishing reauth",
    async (code) => {
      const state = setup();
      state.security.changeMyPassword.mockRejectedValue(new ActionError(code));
      expect(await state.actions.changePassword(password)).toEqual({
        ok: false,
        code,
      });
      expect(state.publisher.publish).not.toHaveBeenCalled();
      expect(state.logError).not.toHaveBeenCalled();
    },
  );

  it("does not publish reauth when password change preserves other sessions", async () => {
    const state = setup();
    expect(
      await state.actions.changePassword({
        ...password,
        revokeOtherSessions: false,
      }),
    ).toEqual({ ok: true, data: {} });
    expect(state.publisher.publish).not.toHaveBeenCalled();
  });

  it.each(["revokeSession", "revokeOtherSessions"] as const)(
    "uses the server user id for %s and publishes exactly once",
    async (name) => {
      const state = setup();
      expect(
        await state.actions[name](
          name === "revokeSession" ? { sessionId } : {},
        ),
      ).toEqual({ ok: true, data: {} });
      if (name === "revokeSession")
        expect(state.security.revokeMySession).toHaveBeenCalledExactlyOnceWith(
          userId,
          sessionId,
        );
      else
        expect(
          state.security.revokeMyOtherSessions,
        ).toHaveBeenCalledExactlyOnceWith(userId);
      expect(state.publisher.publish).toHaveBeenCalledExactlyOnceWith(
        userChannel(userId),
        { type: "realtime.reauth" },
      );
    },
  );

  it.each(["NOT_FOUND", "INVALID_INPUT"] as const)(
    "preserves session revocation error %s without an event",
    async (code) => {
      const state = setup();
      state.security.revokeMySession.mockRejectedValue(new ActionError(code));
      expect(await state.actions.revokeSession({ sessionId })).toEqual({
        ok: false,
        code,
      });
      expect(state.publisher.publish).not.toHaveBeenCalled();
    },
  );

  it.each(["changePassword", "revokeSession", "revokeOtherSessions"] as const)(
    "keeps %s successful when reauth delivery fails, logging a fixed message",
    async (name) => {
      const state = setup();
      const log = vi
        .spyOn(console, "error")
        .mockImplementation(() => undefined);
      state.publisher.publish.mockRejectedValue(
        new Error("private-password token email@example.com"),
      );
      const input =
        name === "changePassword"
          ? password
          : name === "revokeSession"
            ? { sessionId }
            : {};
      expect(await state.actions[name](input)).toEqual({ ok: true, data: {} });
      expect(log).toHaveBeenCalledExactlyOnceWith(
        "Account realtime refresh failed.",
      );
      expect(state.logError).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["updateName", { name: "   " }],
    ["updateName", { name: "가".repeat(51) }],
    ["updateAvatar", {}],
    ["updateAvatar", { color: "red" }],
    ["updateAvatar", { photo: "true" }],
    ["revokeSession", { sessionId: "private-token" }],
    ["revokeOtherSessions", { userId: sessionId }],
    ["updatePreferences", {}],
    ["updatePreferences", { reminderMinutes: [15] }],
    ["updatePreferences", { chatToasts: "false" }],
    ["updatePreferences", { defaultBranchId: sessionId }],
  ] as const)(
    "rejects invalid %s payload %j without a security write",
    async (name, input) => {
      const state = setup();
      expect(await state.actions[name](input)).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
      });
      for (const method of Object.values(state.security))
        expect(method).not.toHaveBeenCalled();
    },
  );
});
