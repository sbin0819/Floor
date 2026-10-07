import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import RootError from "@/app/error";
import MemberError from "@/app/(app)/error";
import AdminError from "@/app/admin/error";
import RootNotFound from "@/app/not-found";
import MemberNotFound from "@/app/(app)/not-found";
import AdminNotFound from "@/app/admin/not-found";

describe("safe route states", () => {
  it.each([RootError, MemberError, AdminError])(
    "retries server data without rendering original errors",
    async (Component) => {
      const retry = vi.fn();
      const props = {
        retry,
        error: new Error("private-token@example.test"),
        reset: vi.fn(),
      };
      render(<Component {...props} />);
      expect(screen.getByRole("heading")).toHaveTextContent(
        "문제가 생겼어요. 잠시 뒤 다시 시도해 주세요",
      );
      expect(screen.queryByText(/private-token/)).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "다시 시도" }));
      expect(retry).toHaveBeenCalledOnce();
      expect(props.reset).not.toHaveBeenCalled();
    },
  );
  it.each([
    { Component: RootNotFound, href: "/", label: "홈으로" },
    { Component: MemberNotFound, href: "/", label: "홈으로" },
    { Component: AdminNotFound, href: "/admin", label: "운영자 홈으로" },
  ])("keeps the appropriate home link $href", ({ Component, href, label }) => {
    render(<Component />);
    expect(screen.getByRole("heading")).toHaveTextContent(
      "찾을 수 없는 화면이에요",
    );
    expect(screen.getByRole("link", { name: label })).toHaveAttribute(
      "href",
      href,
    );
  });
});
