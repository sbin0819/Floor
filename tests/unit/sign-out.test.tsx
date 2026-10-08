import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SignOutButton } from "@/components/sign-out-button";
import { OperatorAccountNotice } from "@/features/auth/components/operator-account-notice";

const { signOut, redirect } = vi.hoisted(() => ({
  signOut: vi.fn(),
  redirect: vi.fn(),
}));
vi.mock("@/lib/auth/client", () => ({ authClient: { signOut } }));
vi.mock("@/lib/auth/redirect-after-sign-out", () => ({
  redirectAfterSignOut: redirect,
}));

beforeEach(() => {
  vi.clearAllMocks();
  signOut.mockResolvedValue({ error: null });
});
afterEach(() => vi.unstubAllGlobals());

describe.each([
  {
    name: "member",
    Component: SignOutButton,
    label: "로그아웃",
    path: "/login",
  },
  {
    name: "operator account switch",
    Component: OperatorAccountNotice,
    label: "다른 계정으로 로그인",
    path: "/admin/login",
  },
])("$name sign out", ({ Component, label, path }) => {
  it("discards the document only after successful sign out", async () => {
    let resolve!: (result: { error: null }) => void;
    signOut.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    render(<Component />);
    const button = screen.getByRole("button", { name: label });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleName(/로그아웃하고 있어요/);
    expect(redirect).not.toHaveBeenCalled();
    await act(async () => resolve({ error: null }));
    expect(redirect).toHaveBeenCalledExactlyOnceWith(path);
  });

  it.each(["response", "exception"])(
    "does not navigate on %s failure and allows retry",
    async (failure) => {
      if (failure === "response")
        signOut.mockResolvedValueOnce({ error: { message: "private detail" } });
      else signOut.mockRejectedValueOnce(new Error("private detail"));
      render(<Component />);
      fireEvent.click(screen.getByRole("button", { name: label }));
      await waitFor(() => expect(screen.getByRole("alert")).toBeVisible());
      expect(screen.getByRole("alert")).not.toHaveTextContent("private detail");
      expect(screen.queryByText(/private detail/)).not.toBeInTheDocument();
      if (path === "/login")
        expect(screen.getByRole("alert")).toHaveTextContent(
          "로그아웃하지 못했어요.",
        );
      expect(redirect).not.toHaveBeenCalled();
      const button = screen.getByRole("button", { name: label });
      expect(button).toBeEnabled();
      fireEvent.click(button);
      await waitFor(() =>
        expect(redirect).toHaveBeenCalledExactlyOnceWith(path),
      );
    },
  );
});

it("uses a full document replacement rather than a retained client route", async () => {
  const { redirectAfterSignOut } = await vi.importActual<
    typeof import("@/lib/auth/redirect-after-sign-out")
  >("@/lib/auth/redirect-after-sign-out");
  const replace = vi.fn();
  vi.stubGlobal("window", { location: { replace } });
  redirectAfterSignOut("/login");
  expect(replace).toHaveBeenCalledExactlyOnceWith("/login");
});
