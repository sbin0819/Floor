import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { StrictMode, Activity } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RealtimeProvider,
  RealtimeSession,
} from "@/components/realtime-provider";
import { useTyping } from "@/features/chat/components/use-typing";
import { createAblyBrowserRealtime } from "@/lib/realtime/ably-browser";
import { createFakeAblyBrowser, fakeTokenFor } from "./ably-test-client";

const user = { id: "user-a", name: "김서연" };
const members = [user, { id: "other", name: "이도윤" }];
function Typing({ roomId = "a" }: { roomId?: string }) {
  const typing = useTyping({ roomId, user, members });
  return (
    <>
      <input
        aria-label="메시지"
        onChange={(event) => typing.onInput(event.target.value)}
      />
      <button onClick={typing.stopTyping}>보내기</button>
      <p role="status">{typing.label}</p>
    </>
  );
}
function setup() {
  const fake = createFakeAblyBrowser();
  const requestToken = vi.fn(
    async (input: Parameters<typeof fakeTokenFor>[0]) => fakeTokenFor(input),
  );
  const realtime = createAblyBrowserRealtime({
    loadClient: fake.loadClient,
    requestToken,
  });
  const createRealtime = () => realtime;
  const ui = (roomId = "a", hidden = false) => (
    <StrictMode>
      <RealtimeProvider createRealtime={createRealtime}>
        <RealtimeSession userId={user.id} />
        <Activity mode={hidden ? "hidden" : "visible"}>
          <Typing roomId={roomId} />
        </Activity>
      </RealtimeProvider>
    </StrictMode>
  );
  return { ...fake, requestToken, ui };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-08T00:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("typing hook and shared provider", () => {
  it("does not read time, request auth or connect during SSR", () => {
    const { ui, loadClient, requestToken } = setup();
    expect(renderToString(ui())).toContain("메시지");
    expect(loadClient).not.toHaveBeenCalled();
    expect(requestToken).not.toHaveBeenCalled();
  });
  it("works in StrictMode, shows verified names and ends when sent", async () => {
    const { ui, client } = setup();
    render(ui());
    await act(() => vi.advanceTimersByTimeAsync(50));
    fireEvent.change(screen.getByLabelText("메시지"), {
      target: { value: "안녕하세요" },
    });
    await act(async () => {});
    const presence = client.channel("room:a").presence;
    expect(presence.enter).toHaveBeenCalledExactlyOnceWith({
      typing: true,
      name: user.name,
    });
    presence.get.mockResolvedValue([
      {
        clientId: "other",
        connectionId: "tab",
        timestamp: Date.now(),
        data: { typing: true, name: "믿지 않는 이름" },
      },
    ]);
    await act(async () => presence.subscribe.mock.calls.at(-1)?.[0]());
    expect(screen.getByRole("status")).toHaveTextContent(
      "이도윤 님이 입력하고 있어요",
    );
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await act(async () => {});
    expect(presence.update).toHaveBeenCalledExactlyOnceWith({ typing: false });
  });
  it("leaves on room changes and Activity hide, then reactivates without reviving old typists", async () => {
    const { ui, client } = setup();
    const { rerender } = render(ui());
    await act(() => vi.advanceTimersByTimeAsync(50));
    fireEvent.change(screen.getByLabelText("메시지"), {
      target: { value: "처음" },
    });
    await act(async () => {});
    rerender(ui("b"));
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(client.channel("room:a").presence.leave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    fireEvent.change(screen.getByLabelText("메시지"), {
      target: { value: "새 방" },
    });
    await act(async () => {});
    expect(client.channel("room:b").presence.enter).toHaveBeenCalledTimes(1);
    rerender(ui("b", true));
    await act(() => vi.advanceTimersByTimeAsync(50));
    expect(client.channel("room:b").presence.leave).toHaveBeenCalledTimes(1);
    rerender(ui("b"));
    await act(() => vi.advanceTimersByTimeAsync(3_000));
    fireEvent.change(screen.getByLabelText("메시지"), {
      target: { value: "복귀" },
    });
    await act(async () => {});
    expect(client.channel("room:b").presence.enter).toHaveBeenCalledTimes(2);
  });
});
