import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import {
  MutationCache,
  QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChatMuteButton } from "@/features/chat/components/chat-mute-button";
import { setRoomMuted, setSpaceMuted } from "@/features/chat/actions";
import type { ActionResult } from "@/lib/actions/result";
import { ApiError } from "@/lib/http/errors";
import { errorMessage, SESSION_EXPIRED_MESSAGE } from "@/lib/errors/messages";
import { notifySessionExpired } from "@/lib/errors/session-expired";

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
  const client = new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (result) => {
        notifySessionExpired(client, result);
      },
      onError: (error) => {
        notifySessionExpired(client, error);
      },
    }),
  });
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
  it.each(["result", "http"] as const)(
    "deduplicates repeated %s expiry without refreshing or changing the menu value",
    async (source) => {
      if (source === "result")
        vi.mocked(setRoomMuted).mockResolvedValue({
          ok: false,
          code: "UNAUTHENTICATED",
        });
      else
        vi.mocked(setRoomMuted).mockRejectedValue(
          new ApiError("http", { status: 401 }),
        );
      setup();
      for (let attempt = 0; attempt < 2; attempt++) {
        await act(async () => fireEvent.click(await open()));
        await waitFor(() =>
          expect(setRoomMuted).toHaveBeenCalledTimes(attempt + 1),
        );
      }
      expect(effects.error).toHaveBeenCalledExactlyOnceWith(
        SESSION_EXPIRED_MESSAGE,
        expect.objectContaining({ id: "session-expired" }),
      );
      expect(effects.refresh).not.toHaveBeenCalled();
      expect(await open()).toHaveTextContent("알림 켜기");
    },
  );
  it.each(["network", "timeout"] as const)(
    "uses the shared %s message",
    async (kind) => {
      const error = new ApiError(kind);
      vi.mocked(setRoomMuted).mockRejectedValue(error);
      setup();
      await act(async () => fireEvent.click(await open()));
      await waitFor(() =>
        expect(effects.error).toHaveBeenCalledExactlyOnceWith(
          errorMessage(error),
        ),
      );
      expect(effects.refresh).not.toHaveBeenCalled();
      expect(setRoomMuted).toHaveBeenCalledOnce();
    },
  );
  it("does not toast or retry an intentionally canceled update", async () => {
    vi.mocked(setRoomMuted).mockRejectedValue(
      new DOMException("Aborted", "AbortError"),
    );
    setup();
    await act(async () => fireEvent.click(await open()));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "일반 알림 설정" }),
      ).toBeEnabled(),
    );
    expect(effects.error).not.toHaveBeenCalled();
    expect(effects.refresh).not.toHaveBeenCalled();
    expect(setRoomMuted).toHaveBeenCalledOnce();
  });
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
