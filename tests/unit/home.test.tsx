import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import Home from "@/app/(app)/page";
import { requirePageSession } from "@/lib/auth/session";
import { getHomeData } from "@/features/teams/queries";
import { resolvePageContent } from "./page-test-utils";
import { getBookingEntry } from "@/features/bookings/queries";

vi.mock("@/lib/auth/session", () => ({ requirePageSession: vi.fn() }));
vi.mock("@/features/teams/queries", () => ({ getHomeData: vi.fn() }));
vi.mock("@/features/bookings/queries", () => ({
  getBookingEntry: vi.fn().mockResolvedValue(null),
}));

it("checks the session on the page and greets the current member", async () => {
  vi.mocked(requirePageSession).mockResolvedValue({
    userId: "member",
    email: "member@example.test",
    name: "가상 회원",
  });
  vi.mocked(getHomeData).mockResolvedValue({
    name: "가상 회원",
    teams: [],
    pendingInviteCount: 2,
    isOperator: false,
  });
  render(await resolvePageContent(Home()));
  expect(requirePageSession).toHaveBeenCalledWith("/");
  expect(
    screen.getByRole("heading", { name: "안녕하세요, 가상 회원님" }),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "팀 회원으로 전환" }),
  ).toHaveAttribute("href", "/teams/start");
  expect(screen.getByText("받은 초대 2개")).toBeVisible();
  expect(screen.getByRole("link", { name: "공간 예약하기" })).toHaveAttribute(
    "href",
    "/branches",
  );
  expect(
    screen.queryByRole("link", { name: "운영자 화면" }),
  ).not.toBeInTheDocument();
});

it("shows memberships and the operator destination without unrelated navigation", async () => {
  vi.mocked(getBookingEntry).mockResolvedValue("default-branch");
  vi.mocked(getHomeData).mockResolvedValue({
    name: "가상 회원",
    teams: [{ id: "team", name: "가상 팀", role: "admin" }],
    pendingInviteCount: 0,
    isOperator: true,
  });
  render(await resolvePageContent(Home()));
  expect(screen.getByRole("link", { name: "가상 팀" })).toHaveAttribute(
    "href",
    "/teams/team",
  );
  expect(screen.getByText("팀 관리자")).toBeVisible();
  expect(
    screen.getByRole("link", { name: "다른 팀 만들기·가입" }),
  ).toHaveAttribute("href", "/teams/start");
  expect(screen.getByRole("link", { name: "운영자 화면" })).toHaveAttribute(
    "href",
    "/admin",
  );
  expect(screen.queryByText("팀 예약")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "공간 예약하기" })).toHaveAttribute(
    "href",
    "/branches/default-branch",
  );
});
