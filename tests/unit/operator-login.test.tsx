import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/features/auth/components/login-form";
import { OperatorAccountNotice } from "@/features/auth/components/operator-account-notice";
import { authMessages } from "@/features/auth/messages";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  signOut: vi.fn(),
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  documentRedirect: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: mocks.push,
    replace: mocks.replace,
    refresh: mocks.refresh,
  }),
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: { signIn: { email: mocks.login }, signOut: mocks.signOut },
}));
vi.mock("@/lib/auth/redirect-after-sign-out", () => ({
  redirectAfterSignOut: mocks.documentRedirect,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.login.mockResolvedValue({ error: null });
  mocks.signOut.mockResolvedValue({ error: null });
});

describe("operator login", () => {
  it("offers email credentials only and always goes to admin after success", async () => {
    const user = userEvent.setup();
    render(
      <LoginForm operator providers={["google", "github"]} next="/unrelated" />,
    );
    expect(
      screen.queryByRole("button", { name: /로 계속하기/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "계정 만들기" }),
    ).not.toBeInTheDocument();
    await user.type(screen.getByLabelText("이메일"), "ops@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "password123");
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(mocks.replace).toHaveBeenCalledWith("/admin");
  });

  it("keeps a non-operator signed in until they explicitly choose another account", async () => {
    const user = userEvent.setup();
    render(<OperatorAccountNotice />);
    expect(screen.getByText(authMessages.notOperator)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "홈으로" })).toHaveAttribute(
      "href",
      "/",
    );
    expect(mocks.signOut).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "다른 계정으로 로그인" }),
    );
    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(mocks.documentRedirect).toHaveBeenCalledExactlyOnceWith(
      "/admin/login",
    );
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("does not navigate if signing out failed", async () => {
    mocks.signOut.mockResolvedValue({
      error: { message: "secret session detail" },
    });
    const user = userEvent.setup();
    render(<OperatorAccountNotice />);
    await user.click(
      screen.getByRole("button", { name: "다른 계정으로 로그인" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      authMessages.genericError,
    );
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.documentRedirect).not.toHaveBeenCalled();
    expect(screen.queryByText("secret session detail")).not.toBeInTheDocument();
  });
});
