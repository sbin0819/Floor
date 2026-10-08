import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AccountMenu } from "@/components/account-menu";
import { CHAT_NAV_KEY } from "@/features/chat/nav-state";
import type { ChatNav } from "@/features/chat/types";
import type { ActionResult } from "@/lib/actions/result";
const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  error: vi.fn(),
  publish: vi.fn(),
}));
vi.mock("@/features/people/actions", () => ({ setStatus: mocks.save }));
vi.mock("@/lib/auth/client", () => ({ authClient: { signOut: vi.fn() } }));
vi.mock("sonner", () => ({ toast: { error: mocks.error } }));
vi.mock("@/components/realtime-provider", () => ({
  useRealtimeScope: () => ({ status: { status: "away", auto: true } }),
  useStatusPresencePublisher: () => mocks.publish,
}));
beforeEach(() => vi.clearAllMocks());
function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData<ChatNav>(CHAT_NAV_KEY, {
    filesEnabled: false,
    chatToasts: true,
    tabBadge: true,
    callsEnabled: false,
    calls: [],
    myCall: null,
    spaces: [],
    directMessages: [],
    blockedUserIds: [],
    meetings: [],
    now: "2026-10-08T03:00:00.000Z",
    myStatus: "online",
  });
  render(
    <QueryClientProvider client={client}>
      <AccountMenu
        avatar={{ color: "blue", photoUrl: null }}
        name="가상 회원"
        email="member@example.test"
        username="floor.member"
        myStatus="online"
        isOperator={false}
        variant="card"
      />
    </QueryClientProvider>,
  );
  return client;
}
describe("self status menu", () => {
  it("shows the automatic away state and persists exactly one action input before updating presence", async () => {
    const client = show();
    const user = userEvent.setup();
    let resolve!: (value: ActionResult<{ status: "dnd" }>) => void;
    mocks.save.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    expect(screen.getByText("자리 비움 (자동)")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "가상 회원님 사용자 메뉴" }),
    );
    expect(screen.getByText("@floor.member")).toBeInTheDocument();
    const option = screen.getByRole("menuitemradio", { name: "방해 금지" });
    await user.click(option);
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith({ status: "dnd" });
    expect(mocks.publish).not.toHaveBeenCalled();
    await act(async () => resolve({ ok: true, data: { status: "dnd" } }));
    expect(client.getQueryData<ChatNav>(CHAT_NAV_KEY)?.myStatus).toBe("dnd");
    expect(mocks.publish).toHaveBeenCalledExactlyOnceWith({
      status: "dnd",
      auto: false,
    });
  });
  it("keeps the stored choice on failure and displays a fixed safe message", async () => {
    const client = show();
    mocks.save.mockResolvedValue({ ok: false, code: "INTERNAL" });
    const user = userEvent.setup();
    await user.click(
      screen.getByRole("button", { name: "가상 회원님 사용자 메뉴" }),
    );
    await user.click(screen.getByRole("menuitemradio", { name: "방해 금지" }));
    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledExactlyOnceWith(
        "상태를 바꾸지 못했어요. 다시 시도해 주세요",
      ),
    );
    expect(client.getQueryData<ChatNav>(CHAT_NAV_KEY)?.myStatus).toBe("online");
    expect(mocks.publish).not.toHaveBeenCalled();
  });
});
