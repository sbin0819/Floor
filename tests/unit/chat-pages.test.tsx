import { render, screen } from "@testing-library/react";
import { Suspense, type ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SpacePage from "@/app/(app)/s/[spaceId]/page";
import ChannelPage from "@/app/(app)/s/[spaceId]/[roomId]/page";
import MessagesPage from "@/app/(app)/messages/page";
import { ChannelScreen } from "@/features/chat/components/channel-screen";
import { SpaceAccessBoundary } from "@/features/chat/components/space-access-boundary";
import { resolvePageContent } from "./page-test-utils";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  nav: vi.fn(),
  channel: vi.fn(),
  redirect: vi.fn(),
  notFound: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  requirePageSession: mocks.guard,
  getSession: vi.fn(),
  requireSession: vi.fn(),
}));
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
vi.mock("@/features/chat/components/chat-nav", () => ({
  LiveDirectMessages: () => null,
  LiveMeetings: () => null,
}));
const spaceId = "a1111111-1111-4111-8111-111111111111";
const roomId = "b2222222-2222-4222-8222-222222222222";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue(undefined);
  mocks.nav.mockResolvedValue({
    spaces: [{ id: spaceId, channels: [{ id: roomId }] }],
    directMessages: [],
    myStatus: "online",
    blockedUserIds: [],
    meetings: [],
    now: "2026-10-08T03:00:00.000Z",
  });
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
  it.each([{ nav: [] }])(
    "does not reveal an inaccessible space",
    async ({ nav }) => {
      mocks.nav.mockResolvedValue({
        spaces: nav,
        directMessages: [],
        myStatus: "online",
        blockedUserIds: [],
        meetings: [],
        now: "2026-10-08T03:00:00.000Z",
      });
      const page = SpacePage({ params: Promise.resolve({ spaceId }) });
      await expect(resolvePageContent(page.props.children)).rejects.toThrow(
        "not-found",
      );
      expect(mocks.redirect).not.toHaveBeenCalled();
    },
  );
  it("shows an authorized channel-less space without recreating channels", async () => {
    mocks.nav.mockResolvedValue({
      spaces: [
        {
          id: spaceId,
          kind: "team",
          role: "member",
          name: "가상 팀",
          channels: [],
        },
      ],
    });
    const content = await resolvePageContent(
      SpacePage({ params: Promise.resolve({ spaceId }) }).props.children,
    );
    expect(content.type).toBe(SpaceAccessBoundary);
    render(content.props.children as ReactElement);
    expect(screen.getByRole("heading", { name: "가상 팀" })).toBeVisible();
    expect(screen.getByText("아직 열린 채널이 없어요")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "채널 만들기" }),
    ).not.toBeInTheDocument();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.notFound).not.toHaveBeenCalled();
  });
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
    expect(content.type).toBe(SpaceAccessBoundary);
    expect(content.props.spaceId).toBe(spaceId);
    const screen = content.props.children as ReactElement<{ data: unknown }>;
    expect(screen.type).toBe(ChannelScreen);
    expect(screen.props.data).toBe(view);
    expect(screen.key).toBe(roomId);
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
    mocks.nav.mockResolvedValue({
      spaces: [],
      directMessages: [],
      myStatus: "online",
      blockedUserIds: [],
      meetings: [],
      now: "2026-10-08T03:00:00.000Z",
    });
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
