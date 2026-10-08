import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  RealtimeProvider,
  RealtimeSession,
  useRealtimeChannel,
  useRealtimeConnectionState,
  useRealtimeLifecycle,
} from "@/components/realtime-provider";
import { createAblyBrowserRealtime } from "@/lib/realtime/ably-browser";
import type { RealtimeEvent } from "@/lib/realtime/types";

import { createFakeAblyBrowser, fakeTokenRequest } from "./ably-test-client";

function setup() {
  const fake = createFakeAblyBrowser();
  const requestToken = vi.fn(async () => fakeTokenRequest);
  const createRealtime = vi.fn(() =>
    createAblyBrowserRealtime({ loadClient: fake.loadClient, requestToken }),
  );
  return { ...fake, requestToken, createRealtime };
}

function Listener({
  channel = "room:a",
  onEvent = () => {},
}: {
  channel?: string;
  onEvent?: (event: RealtimeEvent) => void;
}) {
  useRealtimeChannel(channel, onEvent);
  return null;
}

function State() {
  const state = useRealtimeConnectionState();
  return <output aria-label="연결 상태">{state}</output>;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("shell realtime provider", () => {
  it("renders the fixed shell before a session arrives without changing its DOM", async () => {
    const { createRealtime, requestToken, client } = setup();
    const ui = (userId: string | null) => (
      <RealtimeProvider createRealtime={createRealtime}>
        <header>Floor</header>
        <Listener />
        <State />
        <RealtimeSession userId={userId} />
      </RealtimeProvider>
    );
    const { rerender, unmount } = render(ui(null));
    const header = screen.getByRole("banner");
    await act(() => vi.runAllTimersAsync());
    expect(requestToken).not.toHaveBeenCalled();
    rerender(ui("user-a"));
    await act(() => vi.runAllTimersAsync());
    expect(screen.getByRole("banner")).toBe(header);
    expect(screen.getByRole("status", { name: "연결 상태" })).toHaveTextContent(
      "connected",
    );
    expect(requestToken).toHaveBeenCalledExactlyOnceWith({
      rooms: ["a"],
      spaces: [],
    });
    expect(client.channel("user:user-a").subscribe).toHaveBeenCalledTimes(1);
    unmount();
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it("does not connect during SSR, including an authenticated session leaf", () => {
    const { createRealtime, requestToken, loadClient } = setup();
    expect(
      renderToString(
        <RealtimeProvider createRealtime={createRealtime}>
          <header>Floor</header>
          <RealtimeSession userId="user-a" />
          <State />
        </RealtimeProvider>,
      ),
    ).toContain("Floor");
    expect(requestToken).not.toHaveBeenCalled();
    expect(loadClient).not.toHaveBeenCalled();
  });

  it("shares a single SDK connection under StrictMode and duplicate room hooks", async () => {
    const { createRealtime, loadClient, client } = setup();
    render(
      <StrictMode>
        <RealtimeProvider createRealtime={createRealtime}>
          <RealtimeSession userId="user-a" />
          <Listener />
          <Listener />
        </RealtimeProvider>
      </StrictMode>,
    );
    await act(() => vi.runAllTimersAsync());
    expect(loadClient).toHaveBeenCalledTimes(1);
    expect(client.connect).toHaveBeenCalledTimes(1);
    expect(client.channel("room:a").subscribe).toHaveBeenCalledTimes(1);
  });

  it("uses the latest event handler without detaching or requesting another token", async () => {
    const { createRealtime, client, requestToken } = setup();
    const first = vi.fn();
    const second = vi.fn();
    const ui = (handler: (event: RealtimeEvent) => void) => (
      <RealtimeProvider createRealtime={createRealtime}>
        <RealtimeSession userId="user-a" />
        <Listener onEvent={handler} />
      </RealtimeProvider>
    );
    const { rerender } = render(ui(first));
    await act(() => vi.runAllTimersAsync());
    rerender(ui(second));
    const event: RealtimeEvent = { type: "booking.changed", spaceId: "a" };
    act(() => client.channel("room:a").emit(event));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledExactlyOnceWith(event);
    expect(client.channel("room:a").detach).not.toHaveBeenCalled();
    expect(requestToken).toHaveBeenCalledTimes(1);
  });

  it("exposes lifecycle changes independently of message callbacks", async () => {
    const { createRealtime, emitConnection } = setup();
    const listener = vi.fn();
    function Lifecycle() {
      useRealtimeLifecycle(listener);
      return null;
    }
    const { unmount } = render(
      <RealtimeProvider createRealtime={createRealtime}>
        <RealtimeSession userId="user-a" />
        <Lifecycle />
      </RealtimeProvider>,
    );
    await act(() => vi.runAllTimersAsync());
    act(() =>
      emitConnection({ previous: "connected", current: "disconnected" }),
    );
    expect(listener).toHaveBeenLastCalledWith({
      type: "connection",
      previous: "connected",
      current: "disconnected",
    });
    unmount();
    listener.mockClear();
    emitConnection({ previous: "disconnected", current: "connected" });
    expect(listener).not.toHaveBeenCalled();
  });

  it("provides a quiet disabled fallback outside a provider", () => {
    render(
      <>
        <State />
        <Listener />
        <RealtimeSession userId="user-a" />
      </>,
    );
    expect(screen.getByRole("status", { name: "연결 상태" })).toHaveTextContent(
      "disabled",
    );
  });
});
