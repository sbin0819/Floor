import { Children, Suspense, isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FriendsPage from "@/app/(app)/friends/page";
import SettingsPage from "@/app/(app)/settings/page";
import SettingsLayout from "@/app/(app)/settings/layout";
import { requirePageSession } from "@/lib/auth/session";
import { getFriendsView, getMessageRequests } from "@/features/people/queries";
import { getProfileSettings } from "@/features/settings/queries";
import type { ProfileSettings } from "@/features/settings/types";
import { SettingsSkeleton } from "@/features/settings/components/settings-shell";
import { SettingsTabLinks } from "@/features/settings/components/settings-tabs";
import { resolvePageContent } from "./page-test-utils";

vi.mock("@/lib/auth/session", () => ({ requirePageSession: vi.fn() }));
vi.mock("@/features/people/queries", () => ({
  getFriendsView: vi.fn(),
  getMessageRequests: vi.fn(),
}));
vi.mock("@/features/settings/queries", () => ({
  getProfileSettings: vi.fn(),
}));
vi.mock("@/features/people/components/friends-screen", () => ({
  FriendsScreen: () => null,
}));
vi.mock("@/features/settings/components/profile-settings", () => ({
  ProfileSettings: () => null,
}));

const settings = {
  username: "haeun.kim",
  usernameChangedAt: null,
  nextChangeAt: null,
  now: "2030-01-01T00:00:00Z",
  suggestion: null,
};
const profile: ProfileSettings = {
  userId: "me",
  name: "프로필에서 읽은 이름",
  avatar: { color: "blue", photoUrl: null },
  photo: false,
  photoProvider: null,
  photoUrl: null,
  usernameSettings: settings,
  preview: {
    userId: "me",
    name: "프로필에서 읽은 이름",
    avatar: { color: "blue", photoUrl: null },
    username: settings.username,
    isMe: true,
    relation: null,
    sharedSpaces: [],
    directRoomId: null,
    canDirectMessage: false,
  },
};
function content(page: ReactNode) {
  if (!isValidElement<{ children: ReactNode }>(page))
    throw new Error("Missing fixed shell");
  expect(isValidElement(page.props.children) && page.props.children.type).toBe(
    Suspense,
  );
  return resolvePageContent(page.props.children);
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePageSession).mockResolvedValue({
    userId: "me",
    name: "김하은",
    email: "own@example.test",
  });
  vi.mocked(getProfileSettings).mockResolvedValue(profile);
  vi.mocked(getMessageRequests).mockResolvedValue([]);
  vi.mocked(getFriendsView).mockResolvedValue({
    settings,
    receivedCount: 0,
    messageRequestCount: 0,
    rows: [],
  });
});

describe("people pages maintain direct guards and static shells", () => {
  it.each([undefined, "all", "unknown", ["received", "sent"]])(
    "normalizes invalid tab %s before the guarded lookup",
    async (tab) => {
      const page = FriendsPage({ searchParams: Promise.resolve({ tab }) });
      expect(page.props.title).toBe("친구");
      expect(requirePageSession).not.toHaveBeenCalled();
      const result = await content(page);
      expect(requirePageSession).toHaveBeenCalledExactlyOnceWith("/friends");
      expect(getFriendsView).toHaveBeenCalledExactlyOnceWith("all");
      expect(result.props.tab).toBe("all");
    },
  );
  it.each(["received", "sent", "requests", "blocked"])(
    "preserves the valid %s return path",
    async (tab) => {
      await content(FriendsPage({ searchParams: Promise.resolve({ tab }) }));
      expect(requirePageSession).toHaveBeenCalledWith(`/friends?tab=${tab}`);
      expect(getFriendsView).toHaveBeenCalledWith(tab);
      if (tab === "requests") expect(getMessageRequests).toHaveBeenCalledOnce();
      else expect(getMessageRequests).not.toHaveBeenCalled();
    },
  );
  it("keeps the settings layout static and guards its page-local profile lookup", async () => {
    const page = SettingsPage();
    const layout = SettingsLayout({ children: page });
    const [heading, tabs, child] = Children.toArray(layout.props.children);
    expect(
      isValidElement<{ children: ReactNode }>(heading) && heading.type,
    ).toBe("h1");
    expect(
      isValidElement<{ children: ReactNode }>(heading) &&
        heading.props.children,
    ).toBe("설정");
    expect(isValidElement<{ fallback: ReactNode }>(tabs) && tabs.type).toBe(
      Suspense,
    );
    const fallback =
      isValidElement<{ fallback: ReactNode }>(tabs) && tabs.props.fallback;
    expect(isValidElement(fallback) && fallback.type).toBe(SettingsTabLinks);
    expect(child).toEqual(expect.objectContaining({ type: Suspense }));
    expect(page.type).toBe(Suspense);
    expect(page.props.fallback.type).toBe(SettingsSkeleton);
    expect(page.props.fallback.props.tab).toBe("profile");
    expect(requirePageSession).not.toHaveBeenCalled();
    expect(getProfileSettings).not.toHaveBeenCalled();
    const result = await resolvePageContent(page);
    expect(requirePageSession).toHaveBeenCalledExactlyOnceWith("/settings");
    expect(getProfileSettings).toHaveBeenCalledExactlyOnceWith();
    expect(
      vi.mocked(requirePageSession).mock.invocationCallOrder[0],
    ).toBeLessThan(vi.mocked(getProfileSettings).mock.invocationCallOrder[0]!);
    expect(result.props.data).toBe(profile);
    expect(profile.name).not.toBe("김하은");
    expect(result.props).not.toHaveProperty("email");
    expect(result.props.data).not.toHaveProperty("email");
  });
  it("never reads protected queries when the page session guard redirects", async () => {
    vi.mocked(requirePageSession).mockRejectedValue(new Error("redirect"));
    await expect(resolvePageContent(SettingsPage())).rejects.toThrow(
      "redirect",
    );
    await expect(
      content(FriendsPage({ searchParams: Promise.resolve({}) })),
    ).rejects.toThrow("redirect");
    expect(getProfileSettings).not.toHaveBeenCalled();
    expect(getFriendsView).not.toHaveBeenCalled();
  });
});
