import { render, screen } from "@testing-library/react";
import { Suspense } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SpacePage from "@/app/(app)/s/[spaceId]/page";
import ChannelPage from "@/app/(app)/s/[spaceId]/[roomId]/page";
import MessagesPage from "@/app/(app)/messages/page";
import { ChannelScreen } from "@/features/chat/components/channel-screen";
import { resolvePageContent } from "./page-test-utils";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  nav: vi.fn(),
  channel: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requirePageSession: mocks.guard }));
vi.mock("@/features/chat/queries", () => ({
  getMyChatNav: mocks.nav,
  getChannelView: mocks.channel,
}));
vi.mock("@/features/chat/components/channel-screen", () => ({
  ChannelScreen: () => null,
}));
vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
  notFound: mocks.notFound,
}));
const spaceId = "a1111111-1111-4111-8111-111111111111";
const roomId = "b2222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue(undefined);
  mocks.nav.mockResolvedValue([{ id: spaceId, channels: [{ id: roomId }] }]);
  mocks.channel.mockResolvedValue(null);
  mocks.redirect.mockImplementation((path: string) => {
    throw new Error(`redirect:${path}`);
  });
  mocks.notFound.mockImplementation(() => {
    throw new Error("not-found");
  });
});

describe("chat route boundaries", () => {
  it("redirects an accessible space to its first text channel after the page guard", async () => {
    const page = SpacePage({
      params: Promise.resolve({ spaceId: spaceId.toUpperCase() }),
    });
    await expect(resolvePageContent(page.props.children)).rejects.toThrow(
      `redirect:/s/${spaceId}/${roomId}`,
    );
    expect(mocks.guard).toHaveBeenCalledWith(`/s/${spaceId.toUpperCase()}`);
    expect(mocks.guard.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.nav.mock.invocationCallOrder[0]!,
    );
  });
  it("does not query navigation for an invalid UUID", async () => {
    const page = SpacePage({ params: Promise.resolve({ spaceId: "join" }) });
    await expect(resolvePageContent(page.props.children)).rejects.toThrow(
      "not-found",
    );
    expect(mocks.nav).not.toHaveBeenCalled();
    expect(mocks.guard).toHaveBeenCalledWith("/s/join");
  });
  it.each([{ nav: [] }, { nav: [{ id: spaceId, channels: [] }] }])(
    "does not reveal an inaccessible or channel-less space",
    async ({ nav }) => {
      mocks.nav.mockResolvedValue(nav);
      const page = SpacePage({ params: Promise.resolve({ spaceId }) });
      await expect(resolvePageContent(page.props.children)).rejects.toThrow(
        "not-found",
      );
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );
  it("checks the exact channel route and returns the same absent result", async () => {
    await expect(
      resolvePageContent(
        ChannelPage({ params: Promise.resolve({ spaceId, roomId }) }),
      ),
    ).rejects.toThrow("not-found");
    expect(mocks.guard).toHaveBeenCalledWith(`/s/${spaceId}/${roomId}`);
    expect(mocks.channel).toHaveBeenCalledWith(spaceId, roomId);
  });
  it("passes only the authorized view into the channel screen", async () => {
    const view = { room: { id: roomId }, messages: [] };
    mocks.channel.mockResolvedValue(view);
    const content = await resolvePageContent(
      ChannelPage({ params: Promise.resolve({ spaceId, roomId }) }),
    );
    expect(content.type).toBe(ChannelScreen);
    expect(content.props.data).toBe(view);
    expect(content.key).toBe(roomId);
  });
  it("draws the channel skeleton before params or a session are read", () => {
    const page = ChannelPage({ params: new Promise(() => {}) });
    expect(page.type).toBe(Suspense);
    const { container } = render(page.props.fallback);
    expect(container.querySelector("[data-chat-screen]")).not.toBeNull();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.channel).not.toHaveBeenCalled();
  });
  it("guards messages independently and leaves its fixed title outside Suspense", async () => {
    mocks.nav.mockResolvedValue([]);
    const page = MessagesPage();
    expect(page.props.children.type).toBe(Suspense);
    const content = await resolvePageContent(page.props.children);
    expect(mocks.guard).toHaveBeenCalledWith("/messages");
    render(content);
    expect(
      screen.getByRole("link", { name: "팀 관리로 가기" }),
    ).toHaveAttribute("href", "/teams");
  });
});
