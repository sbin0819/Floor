import { Activity, StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BranchDisplayClockProvider,
  useBranchDisplayNow,
} from "@/features/bookings/components/branch-display-clock";

const initial = "2026-10-08T00:59:45.000Z";
const clientTime = Date.parse("2030-01-01T00:00:00Z");
function Clock({
  id = "clock",
  branchId = "branch",
  now = initial,
}: {
  id?: string;
  branchId?: string;
  now?: string;
}) {
  return (
    <output data-testid={id}>{useBranchDisplayNow({ branchId, now })}</output>
  );
}
const advance = (milliseconds: number) => {
  act(() => vi.advanceTimersByTime(milliseconds));
};
describe("branch display clock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(clientTime);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("renders the server snapshot without reading the client clock", () => {
    const read = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("The clock must not be read during SSR.");
    });
    expect(renderToString(<Clock />)).toContain(initial);
    expect(
      renderToString(
        <BranchDisplayClockProvider branchId="branch">
          <Clock />
        </BranchDisplayClockProvider>,
      ),
    ).toContain(initial);
    expect(read).not.toHaveBeenCalled();
  });

  it("advances from the server snapshot at minute boundaries, not the browser's date", () => {
    render(<Clock />);
    expect(screen.getByTestId("clock")).toHaveTextContent(initial);
    expect(vi.getTimerCount()).toBe(1);
    advance(14_999);
    expect(screen.getByTestId("clock")).toHaveTextContent(initial);
    advance(1);
    expect(screen.getByTestId("clock")).toHaveTextContent(
      "2026-10-08T01:00:00.000Z",
    );
    advance(59_999);
    expect(screen.getByTestId("clock")).toHaveTextContent(
      "2026-10-08T01:00:00.000Z",
    );
    advance(1);
    expect(screen.getByTestId("clock")).toHaveTextContent(
      "2026-10-08T01:01:00.000Z",
    );
    expect(vi.getTimerCount()).toBe(1);
  });

  it("shares the newest response across siblings using only one timer", () => {
    render(
      <BranchDisplayClockProvider branchId="branch">
        <Clock id="header" />
        <Clock id="floor" now="2026-10-08T01:00:30.000Z" />
        <Clock id="detail" now="2026-10-08T00:58:00.000Z" />
      </BranchDisplayClockProvider>,
    );
    for (const id of ["header", "floor", "detail"])
      expect(screen.getByTestId(id)).toHaveTextContent(
        "2026-10-08T01:00:30.000Z",
      );
    expect(vi.getTimerCount()).toBe(1);
    advance(30_000);
    for (const id of ["header", "floor", "detail"])
      expect(screen.getByTestId(id)).toHaveTextContent(
        "2026-10-08T01:01:00.000Z",
      );
  });

  it("resynchronizes to fresh props and ignores older or equal snapshots", () => {
    const view = render(<Clock />);
    advance(15_000);
    view.rerender(<Clock now="2026-10-08T01:05:20.000Z" />);
    expect(screen.getByTestId("clock")).toHaveTextContent(
      "2026-10-08T01:05:20.000Z",
    );
    advance(40_000);
    view.rerender(<Clock now="2026-10-08T01:02:00.000Z" />);
    expect(screen.getByTestId("clock")).toHaveTextContent(
      "2026-10-08T01:06:00.000Z",
    );
    view.rerender(<Clock now="2026-10-08T01:05:20.000Z" />);
    advance(60_000);
    expect(screen.getByTestId("clock")).toHaveTextContent(
      "2026-10-08T01:07:00.000Z",
    );
  });

  it("does not rewind a projected clock when a newer server response arrives late", () => {
    const view = render(<Clock />);
    advance(135_000);
    expect(screen.getByTestId("clock")).toHaveTextContent(
      "2026-10-08T01:02:00.000Z",
    );
    view.rerender(<Clock now="2026-10-08T01:01:00.000Z" />);
    expect(screen.getByTestId("clock")).toHaveTextContent(
      "2026-10-08T01:02:00.000Z",
    );
    advance(60_000);
    expect(screen.getByTestId("clock")).toHaveTextContent(
      "2026-10-08T01:03:00.000Z",
    );
  });

  it("ignores invalid updates instead of replacing a valid clock", () => {
    const view = render(<Clock />);
    view.rerender(<Clock now="invalid" />);
    advance(15_000);
    expect(screen.getByTestId("clock")).toHaveTextContent(
      "2026-10-08T01:00:00.000Z",
    );
  });

  it("keeps branches isolated and resets a provider when its branch changes", () => {
    const tree = (branchId: string) => (
      <BranchDisplayClockProvider branchId={branchId}>
        <Clock branchId={branchId} />
        <Clock id="other" branchId="other" now="2026-10-09T00:00:00.000Z" />
      </BranchDisplayClockProvider>
    );
    const view = render(tree("branch"));
    advance(75_000);
    expect(screen.getByTestId("clock")).toHaveTextContent(
      "2026-10-08T01:01:00.000Z",
    );
    expect(screen.getByTestId("other")).toHaveTextContent(
      "2026-10-09T00:01:00.000Z",
    );
    view.rerender(tree("new-branch"));
    expect(screen.getByTestId("clock")).toHaveTextContent(initial);
    expect(screen.getByTestId("other")).toHaveTextContent(
      "2026-10-09T00:01:00.000Z",
    );
  });

  it("catches up after visibility returns without incrementing by missed timer counts", () => {
    const visibility = vi.spyOn(document, "visibilityState", "get");
    visibility.mockReturnValue("visible");
    render(<Clock />);
    visibility.mockReturnValue("hidden");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(vi.getTimerCount()).toBe(0);
    advance(185_000);
    expect(screen.getByTestId("clock")).toHaveTextContent(initial);
    visibility.mockReturnValue("visible");
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.getByTestId("clock")).toHaveTextContent(
      "2026-10-08T01:02:50.000Z",
    );
    expect(vi.getTimerCount()).toBe(1);
    advance(10_000);
    expect(screen.getByTestId("clock")).toHaveTextContent(
      "2026-10-08T01:03:00.000Z",
    );
  });

  it("resumes the same clock after Activity hides and restores its effects", async () => {
    const tree = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <BranchDisplayClockProvider branchId="branch">
          <Clock />
        </BranchDisplayClockProvider>
      </Activity>
    );
    const view = render(tree("visible"));
    view.rerender(tree("hidden"));
    expect(vi.getTimerCount()).toBe(0);
    advance(135_000);
    await act(async () => view.rerender(tree("visible")));
    expect(screen.getByTestId("clock")).toHaveTextContent(
      "2026-10-08T01:02:00.000Z",
    );
    expect(vi.getTimerCount()).toBe(1);
  });

  it("catches up on a browser page restore and never rewinds on a backward client clock change", () => {
    render(<Clock />);
    act(() => {
      vi.setSystemTime(clientTime + 90_000);
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(screen.getByTestId("clock")).toHaveTextContent(
      "2026-10-08T01:01:15.000Z",
    );
    act(() => {
      vi.setSystemTime(clientTime - 30_000);
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(screen.getByTestId("clock")).toHaveTextContent(
      "2026-10-08T01:01:15.000Z",
    );
  });

  it("cleans up timers and listeners including StrictMode's effect replay", () => {
    const view = render(
      <StrictMode>
        <BranchDisplayClockProvider branchId="branch">
          <Clock />
        </BranchDisplayClockProvider>
      </StrictMode>,
    );
    expect(vi.getTimerCount()).toBe(1);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});
