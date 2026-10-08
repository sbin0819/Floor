import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMuteButton } from "@/features/chat/components/chat-mute-button";
import { setRoomMuted, setSpaceMuted } from "@/features/chat/actions";
import type { ActionResult } from "@/lib/actions/result";

const effects = vi.hoisted(() => ({ refresh: vi.fn(), error: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: effects.refresh }),
}));
vi.mock("sonner", () => ({ toast: { error: effects.error } }));
vi.mock("@/features/chat/actions", () => ({
  setRoomMuted: vi.fn(),
  setSpaceMuted: vi.fn(),
}));

const clients: QueryClient[] = [];
function setup(space = false) {
  const client = new QueryClient();
  clients.push(client);
  render(
    <QueryClientProvider client={client}>
      <ChatMuteButton id="target" name="일반" muted space={space} />
    </QueryClientProvider>,
  );
}
async function open() {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "일반 알림 설정" }),
    { button: 0, ctrlKey: false },
  );
  return screen.findByRole("menuitem", { name: /알림 켜기/ });
}
beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe("chat mute menu", () => {
  it("does not refresh or expose a failed action's details", async () => {
    vi.mocked(setRoomMuted).mockResolvedValue({
      ok: false,
      code: "NOT_FOUND",
      message: "private details",
    });
    setup();
    fireEvent.click(await open());
    await waitFor(() =>
      expect(effects.error).toHaveBeenCalledWith(
        "알림 설정을 바꾸지 못했어요.",
      ),
    );
    expect(effects.refresh).not.toHaveBeenCalled();
    expect(screen.queryByText("private details")).not.toBeInTheDocument();
  });
  it("keeps the menu trigger locked until the single request completes", async () => {
    let finish!: (result: ActionResult<{ muted: boolean }>) => void;
    vi.mocked(setRoomMuted).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    setup();
    fireEvent.click(await open());
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "일반 알림 설정" }),
      ).toBeDisabled(),
    );
    expect(setRoomMuted).toHaveBeenCalledTimes(1);
    await act(async () => finish({ ok: true, data: { muted: false } }));
    await waitFor(() => expect(effects.refresh).toHaveBeenCalledOnce());
  });
  it("uses the space action for the space menu and contains network failures", async () => {
    vi.mocked(setSpaceMuted).mockRejectedValue(
      new Error("private network detail"),
    );
    setup(true);
    fireEvent.click(await open());
    await waitFor(() => expect(effects.error).toHaveBeenCalledOnce());
    expect(setSpaceMuted).toHaveBeenCalledWith({
      spaceId: "target",
      muted: false,
    });
    expect(setRoomMuted).not.toHaveBeenCalled();
    expect(effects.refresh).not.toHaveBeenCalled();
  });
});
