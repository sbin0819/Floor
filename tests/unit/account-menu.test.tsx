import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "@/components/account-menu";

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  documentRedirect: vi.fn(),
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: { signOut: mocks.signOut },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
vi.mock("@/lib/auth/redirect-after-sign-out", () => ({
  redirectAfterSignOut: mocks.documentRedirect,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.signOut.mockResolvedValue({ error: null });
});

const profile = { name: "가상 회원", email: "member@example.test" };
async function openAccount(isOperator = false) {
  const user = userEvent.setup();
  render(<AccountMenu {...profile} isOperator={isOperator} />);
  await user.click(
    screen.getByRole("button", { name: "가상 회원님 사용자 메뉴" }),
  );
  return user;
}

describe("account menu", () => {
  it("shows the initial and name, and reveals email only inside the menu", async () => {
    const user = userEvent.setup();
    render(<AccountMenu {...profile} isOperator={false} />);
    const trigger = screen.getByRole("button", {
      name: "가상 회원님 사용자 메뉴",
    });
    expect(trigger).toHaveTextContent("가가상 회원");
    expect(trigger).toHaveClass("h-11");
    expect(screen.queryByText(profile.email)).not.toBeInTheDocument();
    await user.click(trigger);
    expect(screen.getByText(profile.email)).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: "운영자 화면" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "로그아웃" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "설정" })).toHaveAttribute(
      "href",
      "/settings",
    );
  });

  it("shows the operator destination only for the server-supplied operator flag", async () => {
    await openAccount(true);
    expect(
      screen.getByRole("menuitem", { name: "운영자 화면" }),
    ).toHaveAttribute("href", "/admin");
  });

  it("supports opening and signing out with the keyboard", async () => {
    const user = userEvent.setup();
    render(<AccountMenu {...profile} isOperator={false} />);
    await user.tab();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: "설정" })).toHaveFocus(),
    );
    await user.keyboard("{ArrowDown}");
    const item = screen.getByRole("menuitem", { name: "로그아웃" });
    await waitFor(() => expect(item).toHaveFocus());
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(mocks.documentRedirect).toHaveBeenCalledExactlyOnceWith("/login"),
    );
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });

  it("keeps the pending action disabled and submits only once", async () => {
    const pending = Promise.withResolvers<{ error: null }>();
    mocks.signOut.mockReturnValue(pending.promise);
    const user = await openAccount();
    await user.click(screen.getByRole("menuitem", { name: "로그아웃" }));
    const button = screen.getByRole("menuitem", {
      name: "로그아웃하고 있어요.",
    });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ error: null }));
    expect(mocks.documentRedirect).toHaveBeenCalledExactlyOnceWith("/login");
  });

  it("keeps the menu open to display a safe failure and allow retry", async () => {
    mocks.signOut.mockRejectedValueOnce(new Error("private-token"));
    const user = await openAccount();
    await user.click(screen.getByRole("menuitem", { name: "로그아웃" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "로그아웃하지 못했어요. 다시 시도해 주세요.",
    );
    expect(screen.queryByText(/private-token/)).not.toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "로그아웃" })).toBeEnabled();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.documentRedirect).not.toHaveBeenCalled();
    await user.click(screen.getByRole("menuitem", { name: "로그아웃" }));
    await waitFor(() =>
      expect(mocks.documentRedirect).toHaveBeenCalledExactlyOnceWith("/login"),
    );
  });
});
