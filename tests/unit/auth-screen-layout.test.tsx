import {
  isValidElement,
  Suspense,
  type ReactElement,
  type ReactNode,
  type SuspenseProps,
} from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/app/(auth)/login/page";
import SignupPage from "@/app/(auth)/signup/page";
import ForgotPasswordPage from "@/app/(auth)/forgot-password/page";
import ResetPasswordPage from "@/app/(auth)/reset-password/page";
import VerifyEmailPage from "@/app/(auth)/verify-email/page";
import OperatorLoginPage from "@/app/(auth)/admin/login/page";
import { MemberAuthFrame } from "@/features/auth/components/member-auth-frame";
import { AuthField } from "@/features/auth/components/auth-fields";
import { SignupForm } from "@/features/auth/components/signup-form";
import { AuthCard } from "@/features/auth/components/auth-card";

const mocks = vi.hoisted(() => ({
  mode: "development",
  session: vi.fn(),
  connection: vi.fn(),
}));
vi.mock("next/server", () => ({ connection: mocks.connection }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ getSession: mocks.session }));
vi.mock("@/lib/auth/auth", () => ({
  getAuthUiOptions: () => ({ providers: [], emailEnabled: true }),
}));
vi.mock("@/lib/env", () => ({ getEnv: () => ({ NODE_ENV: mocks.mode }) }));
vi.mock("@/lib/dal", () => ({ getOperatorBranches: vi.fn() }));
vi.mock("@/lib/auth/client", () => ({ authClient: {} }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.mode = "development";
  mocks.session.mockResolvedValue(null);
});

async function resolveContent(page: ReactElement<{ children: ReactNode }>) {
  const card = page.type === MemberAuthFrame ? page.props.children : page;
  if (!isValidElement<{ children: ReactNode }>(card) || card.type !== AuthCard)
    throw new Error("Expected a static auth card");
  const boundary = card.props.children;
  if (!isValidElement<SuspenseProps>(boundary) || boundary.type !== Suspense)
    throw new Error("Request content must be inside Suspense");
  const child = boundary.props.children;
  if (!isValidElement(child) || typeof child.type !== "function")
    throw new Error("Expected a request component");
  return (child.type as (props: unknown) => Promise<ReactNode>)(child.props);
}

describe("member authentication screen frame", () => {
  it("wraps all five member pages but not operator login, without reading request data in the shell", () => {
    const props = { searchParams: Promise.resolve({}) };
    for (const page of [
      LoginPage(props),
      SignupPage(props),
      VerifyEmailPage(props),
      ForgotPasswordPage(),
      ResetPasswordPage(props),
    ]) {
      expect(page.type).toBe(MemberAuthFrame);
      const card = page.props.children;
      expect(isValidElement(card) && card.type).toBe(AuthCard);
      expect(
        isValidElement(card.props.children) && card.props.children.type,
      ).toBe(Suspense);
    }
    expect(OperatorLoginPage().type).toBe(AuthCard);
    expect(OperatorLoginPage().props.children.type).toBe(Suspense);
    expect(mocks.connection).not.toHaveBeenCalled();
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("keeps static introduction separate from its single card slot", () => {
    render(
      <MemberAuthFrame>
        <div data-testid="card">양식</div>
      </MemberAuthFrame>,
    );
    expect(
      screen.getByRole("complementary", { name: "Floor 소개" }),
    ).toHaveClass("hidden", "lg:block");
    expect(
      screen.getByRole("heading", {
        name: "공유오피스의 빈 공간을 찾아 바로 예약해요",
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getAllByTestId("card")).toHaveLength(1);
  });
  it.each(["development", "production"])(
    "gets the %s mail guidance flag on the server",
    async (mode) => {
      mocks.mode = mode;
      const resolved = await resolveContent(
        VerifyEmailPage({
          searchParams: Promise.resolve({ email: "member@example.com" }),
        }),
      );
      render(resolved);
      expect(
        screen.getAllByRole("listitem").map((item) => item.textContent),
      ).toEqual([
        "메일함을 열어 주세요",
        "Floor 인증 메일의 링크를 눌러 주세요",
        "돌아와서 로그인해 주세요",
      ]);
      const hint = screen.queryByText(
        "개발 중에는 메일이 실제로 가지 않아요. 서버 로그의 링크를 열어 주세요",
      );
      if (mode === "development") expect(hint).toBeVisible();
      else expect(hint).not.toBeInTheDocument();
      expect(mocks.connection).toHaveBeenCalledOnce();
    },
  );
  it("toggles a password without losing value or autocomplete and announces the current action", async () => {
    render(
      <AuthField
        label="비밀번호"
        name="password"
        type="password"
        autoComplete="current-password"
      />,
    );
    const input = screen.getByLabelText("비밀번호", { exact: true });
    await userEvent.type(input, "local-test-password");
    await userEvent.click(
      screen.getByRole("button", { name: "비밀번호 보기" }),
    );
    expect(input).toHaveAttribute("type", "text");
    expect(input).toHaveAttribute("autocomplete", "current-password");
    expect(input).toHaveValue("local-test-password");
    const hide = screen.getByRole("button", { name: "비밀번호 숨기기" });
    expect(hide).not.toHaveAttribute("aria-pressed");
    expect(hide).toHaveAttribute("aria-controls", input.id);
    await userEvent.click(hide);
    expect(input).toHaveAttribute("type", "password");
  });
  it("preserves connected errors/help and disables visibility changes during submission", () => {
    render(
      <AuthField
        label="새 비밀번호"
        type="password"
        autoComplete="new-password"
        hint="8자 이상"
        error="입력을 확인해 주세요"
        disabled
      />,
    );
    expect(screen.getByLabelText("새 비밀번호")).toHaveAccessibleDescription(
      "입력을 확인해 주세요 8자 이상",
    );
    expect(
      screen.getByRole("button", { name: "비밀번호 보기" }),
    ).toBeDisabled();
  });
  it("keeps eight-character signup guidance connected and provider labels unchanged", () => {
    render(
      <SignupForm providers={["google", "github"]} emailEnabled next="/" />,
    );
    expect(
      screen.getByLabelText("비밀번호", { exact: true }),
    ).toHaveAccessibleDescription(
      "비밀번호는 8자 이상 128자 이하로 입력해 주세요.",
    );
    expect(
      screen.getByRole("button", { name: "Google로 계속하기" }),
    ).toHaveTextContent("G");
    expect(
      screen.getByRole("button", { name: "GitHub로 계속하기" }),
    ).toHaveTextContent("GH");
    expect(screen.getByLabelText("비밀번호", { exact: true })).toHaveAttribute(
      "autocomplete",
      "new-password",
    );
  });
});
