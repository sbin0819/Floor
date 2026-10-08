import { act, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { SpaceAccessBoundary } from "@/features/chat/components/space-access-boundary";
import { CHAT_NAV_KEY } from "@/features/chat/nav-state";
import type { ChatNav } from "@/features/chat/types";
const nav = (ids: string[]): ChatNav => ({
  filesEnabled: false,
  callsEnabled: false,
  calls: [],
  myCall: null,
  myStatus: "online",
  blockedUserIds: [],
  directMessages: [],
  meetings: [],
  now: "2026-10-08T03:00:00Z",
  spaces: ids.map((id) => ({
    voiceChannels: [],
    id,
    kind: "community",
    role: "member",
    iconColor: "blue",
    name: "모임",
    initial: "모",
    unread: false,
    muted: false,
    unreadMentions: 0,
    channels: [],
  })),
});
function setup(initial?: ChatNav) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (initial) client.setQueryData(CHAT_NAV_KEY, initial);
  const node = (spaceId = "one") => (
    <QueryClientProvider client={client}>
      <SpaceAccessBoundary spaceId={spaceId}>
        <p>현재 화면</p>
      </SpaceAccessBoundary>
    </QueryClientProvider>
  );
  return { client, node, ...render(node()) };
}
describe("space access boundary", () => {
  it("keeps the server-guarded content until a fresh nav removes its membership", async () => {
    const { client } = setup(nav(["one"]));
    expect(screen.getByText("현재 화면")).toBeVisible();
    await act(async () => {
      client.setQueryData(CHAT_NAV_KEY, nav([]));
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "이 스페이스를 더 볼 수 없어요",
    );
    expect(screen.queryByText("현재 화면")).not.toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/messages");
  });
  it("does not deny a new page using an old missing nav or make an extra request", async () => {
    const fetch = vi.spyOn(globalThis, "fetch");
    const { client } = setup(nav([]));
    expect(screen.getByText("현재 화면")).toBeVisible();
    await act(async () => {
      client.setQueryData(CHAT_NAV_KEY, nav(["one"]));
    });
    expect(screen.getByText("현재 화면")).toBeVisible();
    expect(fetch).not.toHaveBeenCalled();
    fetch.mockRestore();
  });
  it("uses a fresh result even if structural sharing preserves an empty initial list", async () => {
    const { client } = setup(nav([]));
    await act(async () => {
      client.setQueryData(CHAT_NAV_KEY, nav([]));
    });
    expect(await screen.findByRole("status")).toBeVisible();
  });
  it("does not reuse the previous space denial while navigating to a new server-guarded space", async () => {
    const { client, node, rerender } = setup(nav(["one"]));
    await act(async () => {
      client.setQueryData(CHAT_NAV_KEY, nav([]));
    });
    expect(await screen.findByRole("status")).toBeVisible();
    rerender(node("two"));
    expect(screen.getByText("현재 화면")).toBeVisible();
  });
});
