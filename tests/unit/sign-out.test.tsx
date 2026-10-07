import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { SignOutButton } from "@/components/sign-out-button";

const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("@/lib/auth/client", () => ({
  authClient: { signOut: mocks.signOut },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
}));
beforeEach(() => vi.clearAllMocks());

it("signs out once and replaces the page with login", async () => {
  let finish: (value: { error: null }) => void = () => {};
  mocks.signOut.mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  render(<SignOutButton />);
  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  const pending = screen.getByRole("button", { name: "로그아웃하고 있어요." });
  expect(pending).toBeDisabled();
  fireEvent.click(pending);
  expect(mocks.signOut).toHaveBeenCalledTimes(1);
  finish({ error: null });
  await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/login"));
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it("does not navigate on a failed signout and hides raw errors", async () => {
  mocks.signOut.mockRejectedValue(new Error("private-token"));
  render(<SignOutButton />);
  fireEvent.click(screen.getByRole("button", { name: "로그아웃" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "로그아웃하지 못했어요.",
  );
  expect(screen.queryByText(/private-token/)).not.toBeInTheDocument();
  expect(mocks.replace).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "로그아웃" })).toBeEnabled();
});
