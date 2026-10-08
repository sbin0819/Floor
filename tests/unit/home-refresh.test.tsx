import { act, cleanup, render } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { HomeRefresh } from "@/features/home/components/home-refresh";
import {
  RealtimeProvider,
  RealtimeSession,
} from "@/components/realtime-provider";
import { createAblyBrowserRealtime } from "@/lib/realtime/ably-browser";
import type { RealtimeEvent } from "@/lib/realtime/types";
import { createFakeAblyBrowser, fakeTokenFor } from "./ably-test-client";

const router = vi.hoisted(() => ({ refresh: vi.fn(), pathname: "/" }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => router.pathname,
}));

beforeEach(() => {
  vi.useFakeTimers();
  router.pathname = "/";
  router.refresh.mockClear();
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function setup() {
  const fake = createFakeAblyBrowser();
  const requestToken = vi.fn(
    async (input: Parameters<typeof fakeTokenFor>[0]) => fakeTokenFor(input),
  );
  const realtime = createAblyBrowserRealtime({
    loadClient: fake.loadClient,
    requestToken,
  });
  const ui = (mode: "visible" | "hidden" = "visible") => (
    <StrictMode>
      <RealtimeProvider createRealtime={() => realtime}>
        <RealtimeSession userId="user-a" />
        <Activity mode={mode}>
          <HomeRefresh userId="user-a" />
        </Activity>
      </RealtimeProvider>
    </StrictMode>
  );
  const view = render(ui());
  await act(() => vi.runAllTimersAsync());
  const emit = (event: RealtimeEvent) =>
    act(() => fake.client.channel("user:user-a").emit(event));
  return { ...view, ...fake, requestToken, emit, ui };
}
function visibility(value: DocumentVisibilityState) {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue(value);
  act(() => document.dispatchEvent(new Event("visibilitychange")));
}
const activity = (
  roomKind: "dm" | "group_dm" | "meeting" | "text",
): RealtimeEvent => ({
  type: "room.activity",
  roomKind,
  roomId: "room",
  spaceId: null,
  bookingId: null,
  seq: 1,
  authorId: "other",
  preview: null,
});

it("reuses the existing user channel and coalesces supported events into one refresh", async () => {
  const { emit, client, requestToken } = await setup();
  expect(client.channel("user:user-a").subscribe).toHaveBeenCalledOnce();
  expect(requestToken).toHaveBeenCalledOnce();
  expect(router.refresh).not.toHaveBeenCalled();
  emit({ type: "friend.changed" });
  emit({ type: "notifications.changed" });
  emit({
    type: "mention.created",
    roomId: "room",
    roomKind: "text",
    spaceId: "space",
    bookingId: null,
    roomName: "일반",
    messageId: "message",
    seq: 1,
    authorName: "가상 회원",
    excerpt: "멘션",
  });
  emit(activity("dm"));
  emit(activity("group_dm"));
  await act(() => vi.advanceTimersByTimeAsync(1999));
  expect(router.refresh).not.toHaveBeenCalled();
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(router.refresh).toHaveBeenCalledOnce();
  expect(client.channel("user:user-a").subscribe).toHaveBeenCalledOnce();
  emit(activity("dm"));
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(router.refresh).toHaveBeenCalledTimes(2);
});
it("ignores meeting/text activities and unrelated events", async () => {
  const { emit } = await setup();
  emit(activity("meeting"));
  emit(activity("text"));
  emit({ type: "room.read", roomId: "room", userId: "user-a", seq: 1 });
  emit({ type: "status.changed", status: "dnd" });
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(router.refresh).not.toHaveBeenCalled();
});
it("defers hidden-tab changes and catches eventless changes once on visibility return", async () => {
  const { emit } = await setup();
  emit(activity("dm"));
  visibility("hidden");
  emit({ type: "friend.changed" });
  emit({ type: "notifications.changed" });
  await act(() => vi.advanceTimersByTimeAsync(10000));
  expect(router.refresh).not.toHaveBeenCalled();
  visibility("visible");
  expect(router.refresh).toHaveBeenCalledOnce();
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(router.refresh).toHaveBeenCalledOnce();
  visibility("hidden");
  visibility("visible");
  expect(router.refresh).toHaveBeenCalledTimes(2);
});
it("stops pending work on route exit without detaching the shell user subscription", async () => {
  const { emit, rerender, ui, client } = await setup();
  emit(activity("dm"));
  router.pathname = "/friends";
  rerender(ui());
  emit({ type: "friend.changed" });
  visibility("hidden");
  visibility("visible");
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(router.refresh).not.toHaveBeenCalled();
  expect(client.channel("user:user-a").detach).not.toHaveBeenCalled();
  router.pathname = "/";
  rerender(ui());
  emit(activity("dm"));
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(router.refresh).toHaveBeenCalledOnce();
});
it("clears Activity-hidden and unmounted timers and restores one listener", async () => {
  const { emit, rerender, ui, unmount } = await setup();
  emit(activity("dm"));
  rerender(ui("hidden"));
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(router.refresh).not.toHaveBeenCalled();
  rerender(ui());
  emit(activity("group_dm"));
  await act(() => vi.advanceTimersByTimeAsync(2000));
  expect(router.refresh).toHaveBeenCalledOnce();
  emit(activity("dm"));
  unmount();
  visibility("hidden");
  visibility("visible");
  await act(() => vi.advanceTimersByTimeAsync(3000));
  expect(router.refresh).toHaveBeenCalledOnce();
});
