import {
  Children,
  isValidElement,
  Suspense,
  type ReactElement,
  type SuspenseProps,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProfilePage from "@/app/(app)/settings/page";
import AccountPage from "@/app/(app)/settings/account/page";
import PreferencePage from "@/app/(app)/settings/preferences/page";
import SettingsLayout from "@/app/(app)/settings/layout";
import {
  SettingsTabs,
  SettingsTabLinks,
} from "@/features/settings/components/settings-tabs";
import { SettingsSkeleton } from "@/features/settings/components/settings-shell";
import { resolvePageContent } from "./page-test-utils";

const mocks = vi.hoisted(() => ({
  guard: vi.fn(),
  profile: vi.fn(),
  account: vi.fn(),
  preferences: vi.fn(),
  pathname: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({ requirePageSession: mocks.guard }));
vi.mock("@/features/settings/queries", () => ({
  getProfileSettings: mocks.profile,
  getAccountSettings: mocks.account,
  getPreferences: mocks.preferences,
}));
vi.mock("@/features/settings/components/profile-settings", () => ({
  ProfileSettings: () => null,
}));
vi.mock("@/features/settings/components/account-settings", () => ({
  AccountSettings: () => null,
}));
vi.mock("@/features/settings/components/preference-settings", () => ({
  PreferenceSettings: () => null,
}));
vi.mock("next/navigation", () => ({ usePathname: mocks.pathname }));
beforeEach(() => {
  vi.clearAllMocks();
  mocks.guard.mockResolvedValue({ userId: "member" });
  mocks.profile.mockResolvedValue({ name: "개인 프로필" });
  mocks.account.mockResolvedValue({ email: "private@example.test" });
  mocks.preferences.mockResolvedValue({ chatToasts: false });
});
const cases = [
  {
    path: "/settings",
    page: ProfilePage,
    tab: "profile",
    query: mocks.profile,
  },
  {
    path: "/settings/account",
    page: AccountPage,
    tab: "account",
    query: mocks.account,
  },
  {
    path: "/settings/preferences",
    page: PreferencePage,
    tab: "preferences",
    query: mocks.preferences,
  },
] as const;
function suspense(value: unknown): ReactElement<SuspenseProps> {
  expect(isValidElement(value)).toBe(true);
  const node = value as ReactElement<SuspenseProps>;
  expect(node.type).toBe(Suspense);
  return node;
}

describe("settings page-local authentication and streaming", () => {
  it.each(cases)(
    "puts $path session and private reads below its own synchronous Suspense boundary",
    ({ page, tab }) => {
      const node = suspense(page());
      const fallback = node.props.fallback as ReactElement<{ tab: string }>;
      expect(fallback.type).toBe(SettingsSkeleton);
      expect(fallback.props.tab).toBe(tab);
      expect(mocks.guard).not.toHaveBeenCalled();
      expect(mocks.profile).not.toHaveBeenCalled();
      expect(mocks.account).not.toHaveBeenCalled();
      expect(mocks.preferences).not.toHaveBeenCalled();
    },
  );

  it.each(cases)(
    "guards $path before its query and renders that query's data",
    async ({ page, path, query }) => {
      const result = await resolvePageContent(page());
      expect(mocks.guard).toHaveBeenCalledExactlyOnceWith(path);
      expect(query).toHaveBeenCalledExactlyOnceWith();
      expect(mocks.guard.mock.invocationCallOrder[0]).toBeLessThan(
        query.mock.invocationCallOrder[0]!,
      );
      expect(result.props.data).toEqual(await query.mock.results[0]!.value);
      for (const other of [mocks.profile, mocks.account, mocks.preferences])
        if (other !== query) expect(other).not.toHaveBeenCalled();
    },
  );

  it.each(cases)(
    "does not read protected $path data when the guard redirects",
    async ({ page }) => {
      mocks.guard.mockRejectedValue(new Error("login redirect"));
      await expect(resolvePageContent(page())).rejects.toThrow(
        "login redirect",
      );
      expect(mocks.profile).not.toHaveBeenCalled();
      expect(mocks.account).not.toHaveBeenCalled();
      expect(mocks.preferences).not.toHaveBeenCalled();
    },
  );

  it.each(cases)(
    "keeps the $path query idle while session validation is pending",
    async ({ page, query }) => {
      let release!: () => void;
      mocks.guard.mockReturnValue(
        new Promise<void>((resolve) => {
          release = resolve;
        }),
      );
      const content = resolvePageContent(page());
      await Promise.resolve();
      expect(query).not.toHaveBeenCalled();
      release();
      await content;
      expect(query).toHaveBeenCalledTimes(1);
    },
  );

  it("renders the static settings title and real tab fallback without reading session or pathname", () => {
    const layout = SettingsLayout({ children: "independent page boundary" });
    const children = Children.toArray(layout.props.children);
    const heading = children[0] as ReactElement<{ children: string }>;
    expect(heading.type).toBe("h1");
    expect(heading.props.children).toBe("설정");
    const tabs = suspense(children[1]);
    expect((tabs.props.fallback as ReactElement).type).toBe(SettingsTabLinks);
    expect((tabs.props.children as ReactElement).type).toBe(SettingsTabs);
    expect(children[2]).toBe("independent page boundary");
    expect(mocks.guard).not.toHaveBeenCalled();
    expect(mocks.pathname).not.toHaveBeenCalled();
  });
});
