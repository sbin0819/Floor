import { render, screen } from "@testing-library/react";
import { cloneElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import AdminHome from "@/app/admin/(shell)/page";
import { requireOperatorPage } from "@/lib/auth/session";
import {
  getOperatorBranchCards,
  getOperatorHome,
} from "@/features/admin/queries";
import { getOperatingState } from "@/features/bookings/operating-state";
import { resolvePageContent } from "./page-test-utils";

vi.mock("@/lib/auth/session", () => ({ requireOperatorPage: vi.fn() }));
vi.mock("@/features/admin/queries", () => ({
  getOperatorHome: vi.fn(),
  getOperatorBranchCards: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
  useRouter: () => ({ push: vi.fn() }),
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
  vi.mocked(getOperatorBranchCards).mockResolvedValue({
    now: "2026-10-07T03:00:00.000Z",
    branches: [
      {
        id: "branch",
        name: "가상점",
        address: "가상로 1",
        floorCount: 2,
        spaceCount: 8,
        operatingState: getOperatingState(
          new Date("2026-10-07T03:00:00Z"),
          "Asia/Seoul",
          {},
        ),
      },
    ],
  });
});

it("checks operator access before rendering assigned branches", async () => {
  vi.mocked(getOperatorHome).mockResolvedValue({
    session,
    branches: [
      { id: "branch", name: "가상점" },
      { id: "branch-2", name: "가상 2호점" },
    ],
  });
  const page = AdminHome();
  render(cloneElement(page, {}, await resolvePageContent(page.props.children)));
  expect(requireOperatorPage).toHaveBeenCalledOnce();
  expect(
    vi.mocked(requireOperatorPage).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(getOperatorHome).mock.invocationCallOrder[0]!);
  expect(screen.getByRole("heading", { name: "운영자 화면" })).toBeVisible();
  expect(screen.getByRole("link", { name: /가상점/ })).toHaveAttribute(
    "href",
    "/admin/branches/branch",
  );
  expect(screen.getByText("층 2개 · 공간 8곳")).toBeVisible();
  expect(screen.getByRole("navigation", { name: "경로" })).toBeVisible();
  expect(vi.mocked(getOperatorHome).mock.invocationCallOrder[0]).toBeLessThan(
    vi.mocked(getOperatorBranchCards).mock.invocationCallOrder[0]!,
  );
});

it("redirects to the sole assigned branch", async () => {
  vi.mocked(getOperatorHome).mockResolvedValue({
    session,
    branches: [{ id: "branch", name: "가상점" }],
  });
  await expect(resolvePageContent(AdminHome().props.children)).rejects.toThrow(
    "REDIRECT:/admin/branches/branch",
  );
  expect(redirect).toHaveBeenCalledWith("/admin/branches/branch");
  expect(getOperatorBranchCards).not.toHaveBeenCalled();
});

it("does not read operator data when the page guard redirects", async () => {
  vi.mocked(requireOperatorPage).mockRejectedValue(new Error("LOGIN_REDIRECT"));
  await expect(resolvePageContent(AdminHome().props.children)).rejects.toThrow(
    "LOGIN_REDIRECT",
  );
  expect(getOperatorHome).not.toHaveBeenCalled();
  expect(getOperatorBranchCards).not.toHaveBeenCalled();
});
