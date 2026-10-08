import { Activity } from "react";
import { act, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PeopleRealtimeSync } from "@/features/people/components/people-realtime-sync";

const mocks = vi.hoisted(() => ({
  pathname: "/friends",
  refresh: vi.fn(),
  channel: "",
  receive: (event: { type: string }) => {
    void event;
  },
}));
vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("@/components/realtime-provider", () => ({
  useRealtimeChannel: (channel: string, receive: typeof mocks.receive) => {
    mocks.channel = channel;
    mocks.receive = receive;
  },
}));
beforeEach(() => {
  vi.useFakeTimers();
  mocks.pathname = "/friends";
  mocks.refresh.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});
function setup() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const ui = (mode: "visible" | "hidden" = "visible", userId = "person") => (
    <QueryClientProvider client={client}>
      <Activity mode={mode}>
        <PeopleRealtimeSync userId={userId} />
      </Activity>
    </QueryClientProvider>
  );
  return { ...render(ui()), invalidate, ui };
}
describe("people and notification change events", () => {
  it("coalesces friend updates and invalidates profile cards while refreshing the friends page", () => {
    const { invalidate } = setup();
    expect(mocks.channel).toBe("user:person");
    act(() => {
      mocks.receive({ type: "friend.changed" });
      mocks.receive({ type: "friend.changed" });
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(150));
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(invalidate).toHaveBeenCalledExactlyOnceWith({
      queryKey: ["people"],
    });
  });
  it("invalidates notification queries once without refreshing the page or modifying the polling cadence", () => {
    const { invalidate } = setup();
    act(() => {
      mocks.receive({ type: "notifications.changed" });
      mocks.receive({ type: "notifications.changed" });
      vi.advanceTimersByTime(150);
    });
    expect(invalidate).toHaveBeenCalledExactlyOnceWith({
      queryKey: ["notifications"],
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(60_000));
    expect(invalidate).toHaveBeenCalledOnce();
  });
  it("checks the current route at flush time and never refreshes a different page", () => {
    const { invalidate, rerender, ui } = setup();
    act(() => mocks.receive({ type: "friend.changed" }));
    mocks.pathname = "/booking";
    rerender(ui());
    act(() => vi.advanceTimersByTime(150));
    expect(invalidate).toHaveBeenCalledOnce();
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("cancels delayed work on Activity hide and on account changes", () => {
    const { invalidate, rerender, ui } = setup();
    act(() => {
      mocks.receive({ type: "friend.changed" });
      mocks.receive({ type: "notifications.changed" });
    });
    rerender(ui("hidden"));
    act(() => vi.advanceTimersByTime(150));
    expect(invalidate).not.toHaveBeenCalled();
    rerender(ui());
    act(() => mocks.receive({ type: "friend.changed" }));
    rerender(ui("visible", "other"));
    act(() => vi.advanceTimersByTime(150));
    expect(invalidate).not.toHaveBeenCalled();
    expect(mocks.channel).toBe("user:other");
  });
});
