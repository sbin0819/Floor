import { Suspense } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import BookingPage from "@/app/(app)/booking/page";
import { getBookingDestination } from "@/features/bookings/queries";
import { requirePageSession } from "@/lib/auth/session";
import { resolvePageContent } from "./page-test-utils";

vi.mock("@/lib/auth/session", () => ({ requirePageSession: vi.fn() }));
vi.mock("@/features/bookings/queries", () => ({
  getBookingDestination: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => {
    throw new Error(`REDIRECT ${href}`);
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getBookingDestination).mockResolvedValue(
    "/branches/branch/floors/floor?date=2026-10-08",
  );
});

it("reads the requested date below Suspense and preserves it for login before resolving one destination", async () => {
  const page = BookingPage({
    searchParams: Promise.resolve({ date: "2026-10-08" }),
  });
  expect(page.type).toBe(Suspense);
  expect(requirePageSession).not.toHaveBeenCalled();
  expect(getBookingDestination).not.toHaveBeenCalled();
  await expect(resolvePageContent(page)).rejects.toThrow(
    "REDIRECT /branches/branch/floors/floor?date=2026-10-08",
  );
  expect(requirePageSession).toHaveBeenCalledExactlyOnceWith(
    "/booking?date=2026-10-08",
  );
  expect(getBookingDestination).toHaveBeenCalledExactlyOnceWith("2026-10-08");
  expect(requirePageSession).toHaveBeenCalledBefore(
    vi.mocked(getBookingDestination),
  );
});

it.each([undefined, ["2026-10-08", "2026-10-09"]])(
  "leaves absent or repeated date validation to the destination without adding a login query",
  async (date) => {
    await expect(
      resolvePageContent(
        BookingPage({ searchParams: Promise.resolve({ date }) }),
      ),
    ).rejects.toThrow("REDIRECT");
    expect(requirePageSession).toHaveBeenCalledExactlyOnceWith("/booking");
    expect(getBookingDestination).toHaveBeenCalledExactlyOnceWith(date);
  },
);

it("encodes the login return query without allowing an input to add query parameters", async () => {
  const date = "2026-10-08&next=https://example.test";
  await expect(
    resolvePageContent(
      BookingPage({ searchParams: Promise.resolve({ date }) }),
    ),
  ).rejects.toThrow("REDIRECT");
  const next = vi.mocked(requirePageSession).mock.calls[0]?.[0];
  const url = new URL(next!, "https://floor.example");
  expect(url.pathname).toBe("/booking");
  expect([...url.searchParams]).toEqual([["date", date]]);
});

it("does not resolve a destination when the direct page guard redirects to login", async () => {
  vi.mocked(requirePageSession).mockRejectedValue(new Error("LOGIN"));
  await expect(
    resolvePageContent(
      BookingPage({
        searchParams: Promise.resolve({ date: "2026-10-08" }),
      }),
    ),
  ).rejects.toThrow("LOGIN");
  expect(requirePageSession).toHaveBeenCalledExactlyOnceWith(
    "/booking?date=2026-10-08",
  );
  expect(getBookingDestination).not.toHaveBeenCalled();
});
