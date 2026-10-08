import { Suspense, isValidElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FriendsPage from "@/app/(app)/friends/page";
import SettingsPage from "@/app/(app)/settings/page";
import { requirePageSession } from "@/lib/auth/session";
import {
  getFriendsView,
  getUsernameSettings,
  getMessageRequests,
} from "@/features/people/queries";
import { resolvePageContent } from "./page-test-utils";

vi.mock("@/lib/auth/session", () => ({ requirePageSession: vi.fn() }));
vi.mock("@/features/people/queries", () => ({
  getFriendsView: vi.fn(),
  getUsernameSettings: vi.fn(),
  getMessageRequests: vi.fn(),
}));
vi.mock("@/features/people/components/friends-screen", () => ({
  FriendsScreen: () => null,
}));
vi.mock("@/features/people/components/settings-screen", () => ({
  SettingsScreen: () => null,
}));

const settings = {
  username: "haeun.kim",
  usernameChangedAt: null,
  nextChangeAt: null,
  now: "2030-01-01T00:00:00Z",
  suggestion: null,
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
  vi.mocked(getUsernameSettings).mockResolvedValue(settings);
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
  it("guards settings before loading its data and takes the display name from the session", async () => {
    const page = SettingsPage();
    expect(page.props.title).toBe("설정");
    expect(requirePageSession).not.toHaveBeenCalled();
    const result = await content(page);
    expect(requirePageSession).toHaveBeenCalledExactlyOnceWith("/settings");
    expect(result.props.name).toBe("김하은");
    expect(result.props).not.toHaveProperty("email");
    expect(getUsernameSettings).toHaveBeenCalledOnce();
  });
  it("never reads protected queries when the page session guard redirects", async () => {
    vi.mocked(requirePageSession).mockRejectedValue(new Error("redirect"));
    await expect(content(SettingsPage())).rejects.toThrow("redirect");
    await expect(
      content(FriendsPage({ searchParams: Promise.resolve({}) })),
    ).rejects.toThrow("redirect");
    expect(getUsernameSettings).not.toHaveBeenCalled();
    expect(getFriendsView).not.toHaveBeenCalled();
  });
});
