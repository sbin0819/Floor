import { act, cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RealtimeProvider,
  RealtimeSession,
  usePresenceStatus,
  useRealtimeReauthorize,
} from "@/components/realtime-provider";
import { createAblyBrowserRealtime } from "@/lib/realtime/ably-browser";
import { StatusSync } from "@/features/people/components/status-sync";
import { useRoomRealtime } from "@/features/chat/components/use-room-realtime";
import type { PresenceMember } from "@/lib/realtime/ably-browser-client";
import { createFakeAblyBrowser, fakeTokenRequest } from "./ably-test-client";

const mocks = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
function Status({ shares = true }: { shares?: boolean }) {
  const status = usePresenceStatus("peer", shares);
  return <output aria-label="상대 상태">{status}</output>;
}
function Room() {
  const denied = useRoomRealtime("room-a");
  const reauthorize = useRealtimeReauthorize();
  return (
    <>
      <output aria-label="접근">{denied ? "denied" : "allowed"}</output>
      <button onClick={reauthorize}>다시 확인</button>
    </>
  );
}
function setup(names = ["space:a"]) {
  const fake = createFakeAblyBrowser();
  const token = vi.fn(async () => ({
    ...fakeTokenRequest,
    capability: JSON.stringify(
      Object.fromEntries(
        ["user:me", "room:room-a", ...names].map((name) => [
          name,
          ["subscribe", "presence"],
        ]),
      ),
    ),
  }));
  const realtime = createAblyBrowserRealtime({
    loadClient: fake.loadClient,
    requestToken: token,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrap = (children: React.ReactNode) => (
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider createRealtime={() => realtime}>
        <RealtimeSession userId="me" />
        {children}
      </RealtimeProvider>
    </QueryClientProvider>
  );
  return { ...fake, realtime, token, queryClient, wrap };
}
async function flush() {
  await act(() => vi.advanceTimersByTimeAsync(500));
}
const member = (
  status: "online" | "away" | "dnd",
  auto = false,
): PresenceMember => ({
  clientId: "peer",
  connectionId: crypto.randomUUID(),
  timestamp: 1,
  data: { status, auto },
});
describe("status presence and revoked room rendering", () => {
  it("does not call an incomplete sync offline and distinguishes no shared space", async () => {
    const { client, wrap } = setup();
    let resolve!: (members: PresenceMember[]) => void;
    client.channel("space:a").presence.get.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const view = render(wrap(<Status />));
    await flush();
    expect(screen.getByLabelText("상대 상태")).toHaveTextContent("unknown");
    await act(async () => {
      resolve([]);
    });
    expect(screen.getByLabelText("상대 상태")).toHaveTextContent("offline");
    view.rerender(wrap(<Status shares={false} />));
    expect(screen.getByLabelText("상대 상태")).toHaveTextContent("unknown");
  });
  it("aggregates multiple connections and clears certainty on disconnect", async () => {
    const { client, wrap, emitConnection } = setup(["space:a", "space:b"]);
    client
      .channel("space:a")
      .presence.get.mockResolvedValue([member("online"), member("away", true)]);
    client
      .channel("space:b")
      .presence.get.mockResolvedValue([member("away"), member("dnd")]);
    render(wrap(<Status />));
    await flush();
    expect(screen.getByLabelText("상대 상태")).toHaveTextContent("dnd");
    act(() =>
      emitConnection({ previous: "connected", current: "disconnected" }),
    );
    expect(screen.getByLabelText("상대 상태")).toHaveTextContent("unknown");
    client.channel("space:b").presence.get.mockResolvedValue([]);
    act(() =>
      emitConnection({ previous: "disconnected", current: "connected" }),
    );
    await flush();
    expect(screen.getByLabelText("상대 상태")).toHaveTextContent("online");
  });
  it("does not infer offline for peers that may only share spaces beyond the token cap", async () => {
    const { wrap } = setup(Array.from({ length: 100 }, (_, i) => `space:${i}`));
    render(wrap(<Status />));
    await flush();
    expect(screen.getByLabelText("상대 상태")).toHaveTextContent("unknown");
  });
  it("updates manual status without restarting the activity clock", async () => {
    const { client, wrap } = setup();
    const view = render(wrap(<StatusSync status="online" />));
    await flush();
    expect(client.channel("space:a").presence.enter).toHaveBeenCalledWith({
      status: "online",
      auto: false,
    });
    view.rerender(wrap(<StatusSync status="dnd" />));
    await flush();
    expect(client.channel("space:a").presence.update).toHaveBeenCalledWith({
      status: "dnd",
      auto: false,
    });
    expect(client.channel("space:a").presence.leave).not.toHaveBeenCalled();
  });
  it("waits until the token assessed a room, then renders denial after reauthorization", async () => {
    const { wrap, token } = setup();
    render(wrap(<Room />));
    expect(screen.getByLabelText("접근")).toHaveTextContent("allowed");
    await flush();
    token.mockResolvedValue({
      ...fakeTokenRequest,
      capability: JSON.stringify({ "user:me": ["subscribe"] }),
    });
    act(() => screen.getByRole("button", { name: "다시 확인" }).click());
    await flush();
    expect(screen.getByLabelText("접근")).toHaveTextContent("denied");
  });
  it("coalesces changed metadata refreshes and cancels them on room unmount", async () => {
    const { wrap, client } = setup();
    const view = render(wrap(<Room />));
    await flush();
    act(() => {
      for (let i = 0; i < 5; i++)
        client
          .channel("room:room-a")
          .emit({ type: "room.changed", roomId: "room-a" });
    });
    await flush();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    act(() =>
      client
        .channel("room:room-a")
        .emit({ type: "room.changed", roomId: "room-a" }),
    );
    view.unmount();
    await flush();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
});
