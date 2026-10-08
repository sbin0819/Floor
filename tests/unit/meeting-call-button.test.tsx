import { act, fireEvent, render, screen } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallTarget } from "@/features/calls/client/types";
import { MeetingCallButton } from "@/features/calls/components/meeting-call-button";

const mocks = vi.hoisted(() => ({ join: vi.fn(), phase: "idle" }));
vi.mock("@/features/calls/components/call-provider", () => ({
  useCall: () => ({ join: mocks.join, phase: mocks.phase }),
}));
const target: CallTarget = {
  roomId: "room",
  roomKind: "meeting",
  name: "디자인 리뷰",
  href: "/meetings/booking",
  participants: [],
};
const props = {
  target,
  start: "2026-10-10T01:00:00Z",
  end: "2026-10-10T02:00:00Z",
  now: "2026-10-10T00:49:59Z",
  status: "confirmed" as const,
  enabled: true,
  eligible: true,
};
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime("2030-01-01T00:00:00Z");
  mocks.join.mockReset().mockResolvedValue(undefined);
  mocks.phase = "idle";
});
afterEach(() => {
  vi.useRealTimers();
});
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}
describe("meeting call participation", () => {
  it("renders the same early state on the server without relying on the browser clock", () => {
    const html = renderToString(<MeetingCallButton {...props} />);
    expect(html).toContain("10분 전부터 참여할 수 있어요");
    expect(html).toContain('disabled=""');
  });
  it("enables exactly ten minutes before the meeting using elapsed time", async () => {
    render(<MeetingCallButton {...props} />);
    const button = screen.getByRole("button", { name: "회의 참여" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("10분 전부터 참여할 수 있어요");
    button.focus();
    await advance(999);
    expect(button).toBeDisabled();
    await advance(1);
    expect(button).toBeEnabled();
    expect(
      screen.queryByText("10분 전부터 참여할 수 있어요"),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "회의 참여" })).toBe(button);
  });
  it("does not turn a permission denial into approval when the time window opens", async () => {
    render(<MeetingCallButton {...props} eligible={false} />);
    await advance(60_000);
    expect(screen.getByRole("button", { name: "회의 참여" })).toBeDisabled();
    expect(
      screen.queryByText("10분 전부터 참여할 수 있어요"),
    ).not.toBeInTheDocument();
    expect(mocks.join).not.toHaveBeenCalled();
  });
  it.each([
    { enabled: false },
    { status: "cancelled" as const },
    { now: props.end },
    { now: "2026-10-10T03:00:00Z" },
  ])("is hidden for unavailable, cancelled or ended meetings: %j", (change) => {
    render(<MeetingCallButton {...props} {...change} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("disappears at the exact end without ending an already joined call", async () => {
    render(<MeetingCallButton {...props} now="2026-10-10T01:59:59Z" />);
    expect(screen.getByRole("button")).toBeEnabled();
    await advance(1_000);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(mocks.join).not.toHaveBeenCalled();
  });
  it("uses a refreshed server anchor and does not keep the previous meeting timer", async () => {
    const view = render(<MeetingCallButton {...props} />);
    await advance(500);
    view.rerender(<MeetingCallButton {...props} now="2026-10-10T00:40:00Z" />);
    await advance(500);
    expect(screen.getByRole("button")).toBeDisabled();
    await advance(599_500);
    expect(screen.getByRole("button")).toBeEnabled();
  });
  it("uses the same join target in a sheet and prevents double submission", async () => {
    let finish!: () => void;
    mocks.join.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <section aria-label="회의 시트">
        <MeetingCallButton {...props} now={props.start} />
      </section>,
    );
    const button = screen.getByRole("button", { name: "회의 참여" });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(mocks.join.mock.calls).toEqual([[target]]);
    await act(async () => {
      finish();
    });
  });
  it("disables while device checking or connecting", () => {
    mocks.phase = "checking";
    const view = render(<MeetingCallButton {...props} now={props.start} />);
    expect(screen.getByRole("button")).toBeDisabled();
    mocks.phase = "connecting";
    view.rerender(<MeetingCallButton {...props} now={props.start} />);
    expect(screen.getByRole("button")).toBeDisabled();
  });
});
