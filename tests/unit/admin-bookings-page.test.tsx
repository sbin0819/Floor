import { Suspense } from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import AdminBookingsPage from "@/app/admin/(shell)/branches/[branchId]/bookings/page";
import {
  AdminBookings,
  AdminBookingsSkeleton,
} from "@/features/admin/components/admin-bookings";
import { AdminForbidden } from "@/features/admin/components/admin-forbidden";
import { getAdminBookings } from "@/features/admin/queries";
import { requireOperatorPage } from "@/lib/auth/session";
import { ActionError } from "@/lib/actions/result";
import {
  adminBookingsFixture,
  adminBookingBranchId,
  adminBookingFloorId,
} from "@/tests/helpers/admin-bookings";
import { resolvePageContent } from "./page-test-utils";

vi.mock("@/features/admin/queries", () => ({ getAdminBookings: vi.fn() }));
vi.mock("@/features/admin/booking-actions", () => ({
  cancelBookingAsOperator: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requireOperatorPage: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
function page(
  search: Record<string, string | string[] | undefined> = {},
  branchId = adminBookingBranchId,
) {
  return AdminBookingsPage({
    params: Promise.resolve({ branchId }),
    searchParams: Promise.resolve(search),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOperatorPage).mockResolvedValue({
    userId: "operator",
    name: "가상 운영자",
    email: "operator@example.test",
  });
  vi.mocked(getAdminBookings).mockResolvedValue(adminBookingsFixture());
});
it("streams real title and table headers before its own session or any query", () => {
  const shell = page();
  expect(shell.type).toBe(Suspense);
  expect(shell.props.fallback.type).toBe(AdminBookingsSkeleton);
  expect(requireOperatorPage).not.toHaveBeenCalled();
  expect(getAdminBookings).not.toHaveBeenCalled();
  render(shell.props.fallback);
  expect(screen.getByRole("heading", { name: "예약 현황" })).toBeVisible();
  expect(screen.getAllByRole("columnheader")).toHaveLength(7);
  expect(
    screen.queryByText(/0건|조건에 맞는 예약이 없어요/),
  ).not.toBeInTheDocument();
});
it("runs the page's guard before parsing or querying even an invalid URL", async () => {
  vi.mocked(requireOperatorPage).mockRejectedValue(new Error("LOGIN_REDIRECT"));
  await expect(
    resolvePageContent(page({ date: "not-date" }, "invalid")),
  ).rejects.toThrow("LOGIN_REDIRECT");
  expect(getAdminBookings).not.toHaveBeenCalled();
});
it("passes normalized selected query values only after the page session", async () => {
  const result = await resolvePageContent(
    page({
      date: "2026-10-14",
      days: "7",
      floor: adminBookingFloorId,
      type: "desk",
      status: "all",
      q: "  디자인   팀  ",
      page: "2",
    }),
  );
  expect(result.type).toBe(AdminBookings);
  expect(result.props.data).toEqual(adminBookingsFixture());
  expect(getAdminBookings).toHaveBeenCalledExactlyOnceWith({
    branchId: adminBookingBranchId,
    date: "2026-10-14",
    days: 7,
    floorId: adminBookingFloorId,
    type: "desk",
    status: "all",
    q: "디자인 팀",
    page: 2,
  });
  expect(
    vi.mocked(requireOperatorPage).mock.invocationCallOrder[0],
  ).toBeLessThan(vi.mocked(getAdminBookings).mock.invocationCallOrder[0]!);
});
it("leaves a missing date for the query's own branch timezone clock", async () => {
  await resolvePageContent(page());
  expect(getAdminBookings).toHaveBeenCalledExactlyOnceWith({
    branchId: adminBookingBranchId,
    days: 1,
    status: "confirmed",
    q: "",
    page: 1,
  });
});
it.each([
  { date: "2026-02-30" },
  { days: "2" },
  { page: "0" },
  { page: "1.5" },
  { floor: "foreign-invalid-id" },
  { status: "secret" },
  { type: "unknown" },
  { q: "한" },
  { q: "가".repeat(41) },
  { date: ["2026-10-14", "2026-10-15"] },
  { page: ["1", "2"] },
])(
  "rejects invalid route filters without running the booking query: %j",
  async (search) => {
    render(await resolvePageContent(page(search)));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "날짜와 검색 조건을 확인해 주세요",
    );
    expect(screen.getByRole("heading", { name: "예약 현황" })).toBeVisible();
    expect(requireOperatorPage).toHaveBeenCalledTimes(1);
    expect(getAdminBookings).not.toHaveBeenCalled();
  },
);
it("rejects an invalid branch UUID without a DAL query", async () => {
  render(await resolvePageContent(page({}, "invalid")));
  expect(screen.getByRole("alert")).toBeVisible();
  expect(getAdminBookings).not.toHaveBeenCalled();
});
it("maps a foreign branch or floor to the framework's 404", async () => {
  vi.mocked(getAdminBookings).mockRejectedValue(new ActionError("NOT_FOUND"));
  await expect(resolvePageContent(page())).rejects.toThrow("NOT_FOUND");
});
it("shows direct-entry permission denial instead of data or a redirect loop", async () => {
  vi.mocked(getAdminBookings).mockRejectedValue(new ActionError("FORBIDDEN"));
  const result = await resolvePageContent(page());
  expect(result.type).toBe(AdminForbidden);
  render(result);
  expect(
    screen.getByRole("heading", { name: "이 일을 할 권한이 꺼져 있어요" }),
  ).toBeVisible();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.queryByText("박지훈")).not.toBeInTheDocument();
});
it("does not disguise unexpected query failures as empty or permission-denied data", async () => {
  vi.mocked(getAdminBookings).mockRejectedValue(new Error("query unavailable"));
  await expect(resolvePageContent(page())).rejects.toThrow("query unavailable");
});
