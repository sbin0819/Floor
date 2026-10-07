import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordForm } from "@/features/auth/components/forgot-password-form";
import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";
import { VerifyEmailForm } from "@/features/auth/components/verify-email-form";
import { authMessages } from "@/features/auth/messages";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  requestReset: vi.fn(),
  reset: vi.fn(),
  social: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
    refresh: mocks.refresh,
  }),
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: {
    sendVerificationEmail: mocks.verify,
    requestPasswordReset: mocks.requestReset,
    resetPassword: mocks.reset,
    signIn: { social: mocks.social },
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  for (const method of [
    mocks.verify,
    mocks.requestReset,
    mocks.reset,
    mocks.social,
  ])
    method.mockResolvedValue({ error: null });
});
afterEach(() => vi.useRealTimers());

describe("verification email form", () => {
  it("uses the supplied email without a second input and enforces the 60-second resend cooldown", async () => {
    vi.useFakeTimers();
    render(
      <VerifyEmailForm
        email="Member@Example.com"
        emailEnabled
        providers={[]}
      />,
    );
    expect(screen.queryByLabelText("이메일")).not.toBeInTheDocument();
    const form = screen
      .getByRole("button", { name: "인증 메일 다시 보내기" })
      .closest("form");
    if (!form) throw new Error("Verification form not found");
    await act(async () => {
      fireEvent.submit(form);
    });
    expect(mocks.verify).toHaveBeenCalledWith({
      email: "member@example.com",
      callbackURL: "/login?verified=1",
    });
    expect(
      screen.getByRole("button", { name: "60초 뒤 다시 보낼 수 있어요" }),
    ).toBeDisabled();
    fireEvent.submit(form);
    expect(mocks.verify).toHaveBeenCalledOnce();
    for (let seconds = 0; seconds < 59; seconds += 1)
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
    expect(
      screen.getByRole("button", { name: "1초 뒤 다시 보낼 수 있어요" }),
    ).toBeDisabled();
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    expect(
      screen.getByRole("button", { name: "인증 메일 다시 보내기" }),
    ).toBeEnabled();
  });

  it("asks for an email when the query is missing or invalid", async () => {
    const user = userEvent.setup();
    render(<VerifyEmailForm email="invalid" emailEnabled providers={[]} />);
    await user.type(screen.getByLabelText("이메일"), "member@example.com");
    await user.click(
      screen.getByRole("button", { name: "인증 메일 다시 보내기" }),
    );
    expect(mocks.verify).toHaveBeenCalledWith({
      email: "member@example.com",
      callbackURL: "/login?verified=1",
    });
  });

  it("replaces unavailable mail with its notice and enabled social options", () => {
    render(
      <VerifyEmailForm
        email="member@example.com"
        emailEnabled={false}
        providers={["github"]}
      />,
    );
    expect(screen.getByText(authMessages.emailUnavailable)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "인증 메일 다시 보내기" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "GitHub로 계속하기" }),
    ).toBeEnabled();
  });
});

describe("forgot password form", () => {
  it.each(["success", "unknown-account", "network-failure"])(
    "shows the same response for %s",
    async (outcome) => {
      if (outcome === "unknown-account")
        mocks.requestReset.mockResolvedValue({
          error: { code: "USER_NOT_FOUND", message: "secret result" },
        });
      if (outcome === "network-failure")
        mocks.requestReset.mockRejectedValue(
          new Error("secret connection detail"),
        );
      const user = userEvent.setup();
      render(<ForgotPasswordForm emailEnabled providers={[]} />);
      await user.type(screen.getByLabelText("이메일"), "Member@Example.com");
      await user.click(
        screen.getByRole("button", { name: "재설정 메일 보내기" }),
      );
      expect(mocks.requestReset).toHaveBeenCalledWith({
        email: "member@example.com",
        redirectTo: "/reset-password",
      });
      expect(screen.getByRole("alert")).toHaveTextContent(
        authMessages.resetSent,
      );
      expect(screen.queryByText(/secret/)).not.toBeInTheDocument();
    },
  );

  it("keeps social login available without an email form when mail is unavailable", () => {
    render(<ForgotPasswordForm emailEnabled={false} providers={["google"]} />);
    expect(screen.queryByLabelText("이메일")).not.toBeInTheDocument();
    expect(screen.getByText(authMessages.emailUnavailable)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Google로 계속하기" }),
    ).toBeEnabled();
  });
});

describe("reset password form", () => {
  it("sends the new password with the token and returns to login", async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm token="private-test-token" />);
    await user.type(screen.getByLabelText("새 비밀번호"), "new-password123");
    expect(screen.getByLabelText("새 비밀번호")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    await user.click(screen.getByRole("button", { name: "비밀번호 바꾸기" }));
    expect(mocks.reset).toHaveBeenCalledWith({
      newPassword: "new-password123",
      token: "private-test-token",
    });
    expect(mocks.replace).toHaveBeenCalledWith("/login");
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(screen.queryByText("private-test-token")).not.toBeInTheDocument();
  });

  it.each([
    { token: undefined, invalid: false },
    { token: "expired", invalid: true },
  ])("offers another reset email for invalid entry $token", (props) => {
    render(<ResetPasswordForm {...props} />);
    expect(screen.queryByLabelText("새 비밀번호")).not.toBeInTheDocument();
    expect(screen.getByText(authMessages.invalidReset)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "재설정 메일 다시 받기" }),
    ).toHaveAttribute("href", "/forgot-password");
    expect(mocks.reset).not.toHaveBeenCalled();
  });

  it("turns a rejected token into a recovery link without exposing the token", async () => {
    mocks.reset.mockResolvedValue({
      error: { code: "INVALID_TOKEN", message: "private-test-token" },
    });
    const user = userEvent.setup();
    render(<ResetPasswordForm token="private-test-token" />);
    await user.type(screen.getByLabelText("새 비밀번호"), "new-password123");
    await user.click(screen.getByRole("button", { name: "비밀번호 바꾸기" }));
    expect(screen.getByText(authMessages.invalidReset)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "재설정 메일 다시 받기" }),
    ).toHaveAttribute("href", "/forgot-password");
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(screen.queryByText("private-test-token")).not.toBeInTheDocument();
  });

  it("does not submit passwords outside the shared policy", async () => {
    const user = userEvent.setup();
    render(<ResetPasswordForm token="valid-test-token" />);
    await user.type(screen.getByLabelText("새 비밀번호"), "short");
    await user.click(screen.getByRole("button", { name: "비밀번호 바꾸기" }));
    expect(screen.getByLabelText("새 비밀번호")).toHaveAccessibleDescription(
      "비밀번호는 8자 이상 입력해 주세요",
    );
    expect(mocks.reset).not.toHaveBeenCalled();
  });
});
