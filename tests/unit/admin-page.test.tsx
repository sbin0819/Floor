import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import AdminHome from "@/app/admin/page";
import { requireOperatorPage } from "@/lib/auth/session";
import { getOperatorHome } from "@/features/admin/queries";
import { resolvePageContent } from "./page-test-utils";

vi.mock("@/lib/auth/session", () => ({ requireOperatorPage: vi.fn() }));
vi.mock("@/features/admin/queries", () => ({ getOperatorHome: vi.fn() }));

const session = {
  userId: "operator",
  name: "가상 운영자",
  email: "operator@example.test",
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireOperatorPage).mockResolvedValue(session);
});

it("checks operator access before rendering assigned branches", async () => {
  vi.mocked(getOperatorHome).mockResolvedValue({
    session,
    branches: [{ id: "branch", name: "가상점" }],
  });
  render(await resolvePageContent(AdminHome()));
  expect(requireOperatorPage).toHaveBeenCalledOnce();
  expect(
    vi.mocked(requireOperatorPage).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(getOperatorHome).mock.invocationCallOrder[0]!);
  expect(screen.getByRole("heading", { name: "운영자 화면" })).toBeVisible();
  expect(screen.getByRole("listitem")).toHaveTextContent("가상점");
});

it("does not read operator data when the page guard redirects", async () => {
  vi.mocked(requireOperatorPage).mockRejectedValue(new Error("LOGIN_REDIRECT"));
  await expect(resolvePageContent(AdminHome())).rejects.toThrow(
    "LOGIN_REDIRECT",
  );
  expect(getOperatorHome).not.toHaveBeenCalled();
});
