import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import AdminHome from "@/app/admin/page";
import { requireOperatorPage } from "@/lib/auth/session";
import { getOperatorHome } from "@/features/admin/queries";
import { resolvePageContent } from "./page-test-utils";

vi.mock("@/lib/auth/session", () => ({ requireOperatorPage: vi.fn() }));
vi.mock("@/features/admin/queries", () => ({ getOperatorHome: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
}));

const session = {
  userId: "operator",
  name: "가상 운영자",
  email: "operator@example.test",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOperatorPage).mockResolvedValue(session);
});

it("checks operator access before rendering assigned branches", async () => {
  vi.mocked(getOperatorHome).mockResolvedValue({
    session,
    branches: [
      { id: "branch", name: "가상점" },
      { id: "branch-2", name: "가상 2호점" },
    ],
  });
  render(await resolvePageContent(AdminHome()));
  expect(requireOperatorPage).toHaveBeenCalledOnce();
  expect(
    vi.mocked(requireOperatorPage).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(getOperatorHome).mock.invocationCallOrder[0]!);
  expect(screen.getByRole("heading", { name: "운영자 화면" })).toBeVisible();
  expect(screen.getByRole("link", { name: "가상점" })).toHaveAttribute(
    "href",
    "/admin/branches/branch",
  );
});

it("redirects to the sole assigned branch", async () => {
  vi.mocked(getOperatorHome).mockResolvedValue({
    session,
    branches: [{ id: "branch", name: "가상점" }],
  });
  await expect(resolvePageContent(AdminHome())).rejects.toThrow(
    "REDIRECT:/admin/branches/branch",
  );
  expect(redirect).toHaveBeenCalledWith("/admin/branches/branch");
});

it("does not read operator data when the page guard redirects", async () => {
  vi.mocked(requireOperatorPage).mockRejectedValue(new Error("LOGIN_REDIRECT"));
  await expect(resolvePageContent(AdminHome())).rejects.toThrow(
    "LOGIN_REDIRECT",
  );
  expect(getOperatorHome).not.toHaveBeenCalled();
});
