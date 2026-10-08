import {
  cloneElement,
  isValidElement,
  use,
  type ReactNode,
  type SuspenseProps,
} from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import BookingEditPage from "@/app/(app)/bookings/[bookingId]/edit/page";
import { ActionError } from "@/lib/actions/result";
import type { BookingForEditData } from "@/features/bookings/types";
import { bookingEditFixture } from "./booking-edit-fixtures";

const runtime = vi.hoisted(() => ({
  guard: vi.fn(),
  query: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requirePageSession: runtime.guard }));
vi.mock("@/features/bookings/queries", () => ({
  getBookingForEdit: runtime.query,
}));
vi.mock("next/navigation", () => ({ notFound: runtime.notFound }));
vi.mock("@/features/bookings/components/booking-edit-screen", () => ({
  BookingEditScreen: ({ data }: { data: BookingForEditData }) => (
    <div>{data.space.name}</div>
  ),
}));
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
function Streamed({ result }: { result: Promise<ReactNode> }) {
  return use(result);
}
function parts(params = Promise.resolve({ bookingId: "booking" })) {
  const page = BookingEditPage({ params });
  const boundary = page.props.children;
  if (!isValidElement<SuspenseProps>(boundary))
    throw new Error("Expected Suspense");
  const content = boundary.props.children;
  if (
    !isValidElement<Record<string, unknown>>(content) ||
    typeof content.type !== "function"
  )
    throw new Error("Expected guarded content");
  const run = content.type as (
    props: Record<string, unknown>,
  ) => Promise<ReactNode>;
  return { page, boundary, content: () => run(content.props) };
}
beforeEach(() => {
  vi.clearAllMocks();
  runtime.guard.mockResolvedValue({ userId: "owner" });
  runtime.query.mockResolvedValue(bookingEditFixture());
  runtime.notFound.mockImplementation(() => {
    throw new Error("NEXT_NOT_FOUND");
  });
});
describe("edit page streaming and protection", () => {
  it("shows links and shell before params/session/data without leaking booking details", async () => {
    const params = deferred<{ bookingId: string }>();
    const guard = deferred<unknown>();
    const query = deferred<BookingForEditData>();
    runtime.guard.mockReturnValue(guard.promise);
    runtime.query.mockReturnValue(query.promise);
    const { page, boundary, content } = parts(params.promise);
    const result = content();
    await act(async () => {
      render(
        cloneElement(
          page,
          {},
          cloneElement(boundary, {}, <Streamed result={result} />),
        ),
      );
    });
    const heading = screen.getByRole("heading", {
      name: "예약 바꾸기",
      level: 1,
    });
    expect(heading).toBeVisible();
    expect(screen.getByRole("link", { name: "내 예약으로" })).toHaveAttribute(
      "href",
      "/bookings",
    );
    expect(screen.getByLabelText("예약을 불러오고 있어요")).toHaveAttribute(
      "aria-busy",
      "true",
    );
    expect(runtime.guard).not.toHaveBeenCalled();
    expect(runtime.query).not.toHaveBeenCalled();
    await act(async () => params.resolve({ bookingId: "booking" }));
    expect(runtime.guard).toHaveBeenCalledExactlyOnceWith(
      "/bookings/booking/edit",
    );
    expect(runtime.query).not.toHaveBeenCalled();
    await act(async () => guard.resolve({ userId: "owner" }));
    expect(runtime.query).toHaveBeenCalledExactlyOnceWith("booking");
    expect(screen.queryByText("회의실 C")).not.toBeInTheDocument();
    await act(async () => query.resolve(bookingEditFixture()));
    expect(screen.getByText("회의실 C")).toBeVisible();
    expect(screen.getByRole("heading", { name: "예약 바꾸기", level: 1 })).toBe(
      heading,
    );
  });
  it("stops before query when session guard redirects", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    runtime.guard.mockRejectedValue(redirect);
    await expect(parts().content()).rejects.toBe(redirect);
    expect(runtime.query).not.toHaveBeenCalled();
  });
  it("uses notFound for an unavailable booking but preserves unexpected failures", async () => {
    runtime.query.mockRejectedValue(new ActionError("NOT_FOUND"));
    await expect(parts().content()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(runtime.notFound).toHaveBeenCalledOnce();
    const failure = new Error("database unavailable");
    runtime.query.mockRejectedValue(failure);
    await expect(parts().content()).rejects.toBe(failure);
    expect(runtime.notFound).toHaveBeenCalledOnce();
  });
});
