import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LoginForm } from "@/features/auth/components/login-form";
import { SignupForm } from "@/features/auth/components/signup-form";
import { authMessages } from "@/features/auth/messages";

const mocks = vi.hoisted(() => ({
  login: vi.fn(),
  signup: vi.fn(),
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
    signIn: { email: mocks.login, social: mocks.social },
    signUp: { email: mocks.signup },
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.login.mockResolvedValue({ error: null });
  mocks.signup.mockResolvedValue({ error: null });
  mocks.social.mockResolvedValue({ error: null });
});

async function fillLogin() {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText("이메일"), "Member@Example.com");
  await user.type(screen.getByLabelText("비밀번호"), "password123");
  return user;
}

describe("login form", () => {
  it("shows only enabled social providers and preserves a safe next in signup and OAuth", async () => {
    const user = userEvent.setup();
    render(<LoginForm providers={["github"]} next="/invite/abc?x=1" />);
    expect(
      screen.queryByRole("button", { name: "Google로 계속하기" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "계정 만들기" })).toHaveAttribute(
      "href",
      "/signup?next=%2Finvite%2Fabc%3Fx%3D1",
    );
    await user.click(screen.getByRole("button", { name: "GitHub로 계속하기" }));
    expect(mocks.social).toHaveBeenCalledWith({
      provider: "github",
      callbackURL: "/invite/abc?x=1",
      errorCallbackURL: "/login",
    });
  });

  it("sanitizes unsafe next values before links and social callbacks", async () => {
    const user = userEvent.setup();
    render(<LoginForm providers={["google"]} next="https://evil.example" />);
    expect(screen.getByRole("link", { name: "계정 만들기" })).toHaveAttribute(
      "href",
      "/signup?next=%2F",
    );
    await user.click(screen.getByRole("button", { name: "Google로 계속하기" }));
    expect(mocks.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/",
      errorCallbackURL: "/login",
    });
  });

  it("connects field errors to inputs and never submits invalid fields", async () => {
    const user = userEvent.setup();
    render(<LoginForm />);
    await user.click(screen.getByRole("button", { name: "로그인" }));
    const email = screen.getByLabelText("이메일");
    expect(email).toHaveAttribute("aria-invalid", "true");
    expect(email).toHaveAccessibleDescription("이메일 주소를 확인해 주세요");
    expect(screen.getByLabelText("비밀번호")).toHaveAccessibleDescription(
      "비밀번호를 입력해 주세요",
    );
    expect(mocks.login).not.toHaveBeenCalled();
  });

  it("submits by keyboard, normalizes email, and refreshes the protected destination", async () => {
    render(<LoginForm next="/invite/abc?x=1" />);
    const user = await fillLogin();
    expect(screen.getByLabelText("이메일")).toHaveAttribute(
      "autocomplete",
      "email",
    );
    expect(screen.getByLabelText("비밀번호")).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    await user.keyboard("{Enter}");
    expect(mocks.login).toHaveBeenCalledWith({
      email: "member@example.com",
      password: "password123",
    });
    expect(mocks.replace).toHaveBeenCalledWith("/invite/abc?x=1");
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it.each([
    "INVALID_EMAIL_OR_PASSWORD",
    "USER_NOT_FOUND",
    "INTERNAL_SERVER_ERROR",
  ])(
    "uses the same message for %s without exposing the server message",
    async (code) => {
      mocks.login.mockResolvedValue({
        error: { code, message: "secret backend detail" },
      });
      render(<LoginForm />);
      const user = await fillLogin();
      await user.click(screen.getByRole("button", { name: "로그인" }));
      expect(screen.getByRole("alert")).toHaveTextContent(
        authMessages.loginFailed,
      );
      expect(
        screen.queryByText("secret backend detail"),
      ).not.toBeInTheDocument();
      expect(mocks.replace).not.toHaveBeenCalled();
    },
  );

  it("directs an unverified account to email verification", async () => {
    mocks.login.mockResolvedValue({ error: { code: "EMAIL_NOT_VERIFIED" } });
    render(<LoginForm />);
    const user = await fillLogin();
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(mocks.push).toHaveBeenCalledWith(
      "/verify-email?email=member%40example.com",
    );
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("blocks duplicate submits and concurrent social clicks while a request is pending", async () => {
    const pending = Promise.withResolvers<{ error: null }>();
    mocks.login.mockReturnValue(pending.promise);
    render(<LoginForm providers={["github"]} />);
    await fillLogin();
    const button = screen.getByRole("button", { name: "로그인" });
    const form = button.closest("form");
    if (!form) throw new Error("Login form not found");
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(mocks.login).toHaveBeenCalledOnce();
    expect(
      screen.getByRole("button", { name: "GitHub로 계속하기" }),
    ).toBeDisabled();
    expect(form).toHaveAttribute("aria-busy", "true");
    await act(async () => pending.resolve({ error: null }));
    await waitFor(() => expect(form).toHaveAttribute("aria-busy", "false"));
  });

  it("handles a rejected request without exposing its details", async () => {
    mocks.login.mockRejectedValue(new Error("private credential"));
    render(<LoginForm />);
    const user = await fillLogin();
    await user.click(screen.getByRole("button", { name: "로그인" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      authMessages.loginFailed,
    );
    expect(screen.getByRole("button", { name: "로그인" })).toBeEnabled();
  });
});

describe("signup form", () => {
  it("trims the name and takes every successful response to the same verification screen", async () => {
    const user = userEvent.setup();
    render(<SignupForm providers={[]} emailEnabled next="/invite/abc" />);
    await user.type(screen.getByLabelText("이름"), "  새 멤버  ");
    await user.type(screen.getByLabelText("이메일"), "Member@Example.com");
    await user.type(screen.getByLabelText("비밀번호"), "password123");
    expect(screen.getByLabelText("이름")).toHaveAttribute(
      "autocomplete",
      "name",
    );
    expect(screen.getByLabelText("비밀번호")).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
    await user.click(screen.getByRole("button", { name: "계정 만들기" }));
    expect(mocks.signup).toHaveBeenCalledWith({
      name: "새 멤버",
      email: "member@example.com",
      password: "password123",
      callbackURL: "/login?verified=1",
    });
    expect(mocks.push).toHaveBeenCalledWith(
      "/verify-email?email=member%40example.com",
    );
  });

  it("shows length validation below the correct fields", async () => {
    const user = userEvent.setup();
    render(<SignupForm providers={[]} emailEnabled next="/" />);
    await user.type(screen.getByLabelText("이름"), " ");
    await user.type(screen.getByLabelText("이메일"), "member@example.com");
    await user.type(screen.getByLabelText("비밀번호"), "short");
    await user.click(screen.getByRole("button", { name: "계정 만들기" }));
    expect(screen.getByLabelText("이름")).toHaveAccessibleDescription(
      "이름을 입력해 주세요",
    );
    expect(screen.getByLabelText("비밀번호")).toHaveAccessibleDescription(
      "비밀번호는 8자 이상 입력해 주세요 비밀번호는 8자 이상 128자 이하로 입력해 주세요.",
    );
    expect(mocks.signup).not.toHaveBeenCalled();
  });

  it("replaces the email form when delivery is unavailable while keeping enabled social login", async () => {
    const user = userEvent.setup();
    render(
      <SignupForm
        providers={["google"]}
        emailEnabled={false}
        next="/invite/abc"
      />,
    );
    expect(screen.queryByLabelText("이메일")).not.toBeInTheDocument();
    expect(screen.getByText(authMessages.emailUnavailable)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "계정 만들기" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Google로 계속하기" }));
    expect(mocks.social).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/invite/abc",
      errorCallbackURL: "/login",
    });
  });
});
