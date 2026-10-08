import { screen, waitFor, within } from "@testing-library/react";
import { renderWithQuery as render } from "../helpers/query-render";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "@/components/account-menu";

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  documentRedirect: vi.fn(),
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: { signOut: mocks.signOut },
}));
vi.mock("@/lib/auth/redirect-after-sign-out", () => ({
  redirectAfterSignOut: mocks.documentRedirect,
}));

beforeEach(() => {
  vi.resetAllMocks();
  mocks.signOut.mockResolvedValue({ error: null });
});

const profile = {
  name: "가상 회원",
  email: "member@example.test",
  avatar: { color: "blue" as const, photoUrl: null },
};

describe.each(["card", "avatar"] as const)("%s account menu", (variant) => {
  it.each([false, true])(
    "keeps the accessible name and role-aware contents (operator: %s)",
    async (isOperator) => {
      const user = userEvent.setup();
      render(
        <AccountMenu {...profile} isOperator={isOperator} variant={variant} />,
      );
      const trigger = screen.getByRole("button", {
        name: `${profile.name}님 사용자 메뉴`,
      });
      expect(within(trigger).getByText("가")).toBeVisible();
      expect(screen.queryByText(profile.email)).not.toBeInTheDocument();
      if (variant === "card") {
        expect(trigger).toHaveClass("h-14", "w-full");
        expect(within(trigger).getByText(profile.name)).toHaveClass(
          "truncate",
          "font-semibold",
        );
        expect(trigger.querySelector("[data-user-avatar]")).toHaveClass(
          "size-8",
        );
        expect(trigger.querySelector("svg.lucide")).toHaveClass(
          "lucide-chevrons-up-down",
        );
        expect(trigger.querySelector("svg.lucide")).toHaveAttribute(
          "aria-hidden",
          "true",
        );
      } else {
        expect(trigger).toHaveClass("size-11", "rounded-full");
        expect(
          within(trigger).queryByText(profile.name),
        ).not.toBeInTheDocument();
        expect(trigger.querySelector("svg.lucide")).toBeNull();
      }

      await user.click(trigger);
      expect(screen.getByText(profile.email)).toBeVisible();
      expect(screen.getByRole("menuitem", { name: "로그아웃" })).toBeVisible();
      const operatorLink = screen.queryByRole("menuitem", {
        name: "운영자 화면",
      });
      if (isOperator) expect(operatorLink).toHaveAttribute("href", "/admin");
      else expect(operatorLink).not.toBeInTheDocument();
      expect(screen.getByRole("menu")).toHaveAttribute(
        "data-side",
        variant === "card" ? "top" : "right",
      );
      expect(screen.getByRole("menu")).toHaveAttribute(
        "data-align",
        variant === "card" ? "start" : "end",
      );
    },
  );

  it("supports keyboard sign out and the existing full-document redirect", async () => {
    const user = userEvent.setup();
    render(<AccountMenu {...profile} isOperator={false} variant={variant} />);
    await user.tab();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(
        screen.getByRole("menuitemradio", { name: "온라인" }),
      ).toHaveFocus(),
    );
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "설정" })).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(screen.getByRole("menuitem", { name: "로그아웃" })).toHaveFocus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(mocks.documentRedirect).toHaveBeenCalledExactlyOnceWith("/login"),
    );
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });
});
