import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderWithQuery as render } from "../helpers/query-render";
import { ProfileSettings } from "@/features/settings/components/profile-settings";
import { AccountSettings } from "@/features/settings/components/account-settings";
import { PreferenceSettings } from "@/features/settings/components/preference-settings";
import { SettingsSkeleton } from "@/features/settings/components/settings-shell";
import { SettingsTabLinks } from "@/features/settings/components/settings-tabs";
import type {
  ProfileSettings as ProfileData,
  AccountSettings as AccountData,
  PreferenceSettings as PreferencesData,
} from "@/features/settings/types";
import type { ActionResult } from "@/lib/actions/result";
import type { Avatar } from "@/lib/avatar";
import { CHAT_NAV_KEY } from "@/features/chat/nav-state";

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  success: vi.fn(),
  username: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
  usePathname: () => "/settings",
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: vi.fn() },
}));
vi.mock("@/features/settings/actions", () => ({
  updateName: vi.fn(),
  updateAvatar: vi.fn(),
  changePassword: vi.fn(),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn(),
  updatePreferences: vi.fn(),
}));
vi.mock("@/features/bookings/actions", () => ({ setDefaultBranch: vi.fn() }));
vi.mock("@/features/people/actions", () => ({ setUsername: mocks.username }));
const userId = "11111111-1111-4111-8111-111111111111";
const profile: ProfileData = {
  userId,
  name: "김하은",
  avatar: { color: "blue", photoUrl: null },
  photo: false,
  photoProvider: null,
  photoUrl: null,
  usernameSettings: {
    username: "haeun",
    usernameChangedAt: null,
    nextChangeAt: null,
    now: "2026-10-08T00:00:00Z",
    suggestion: null,
  },
  preview: {
    userId,
    name: "김하은",
    avatar: { color: "blue", photoUrl: null },
    username: "haeun",
    isMe: true,
    relation: null,
    sharedSpaces: [],
    directRoomId: null,
    canDirectMessage: false,
  },
};
const account: AccountData = {
  email: "test1@ai.com",
  emailVerified: true,
  providers: ["credential", "google"],
  sessions: [
    {
      id: "current",
      browser: "Chrome",
      os: "macOS",
      device: "desktop",
      createdAt: "2026-10-01T00:00:00Z",
      updatedAt: "2026-10-08T00:00:00Z",
      current: true,
    },
    {
      id: "other",
      browser: "Safari",
      os: "iOS",
      device: "mobile",
      createdAt: "2026-10-02T00:00:00Z",
      updatedAt: "2026-10-07T00:00:00Z",
      current: false,
    },
  ],
};
const preferences: PreferencesData = {
  chatToasts: true,
  tabBadge: true,
  reminderMinutes: [30, 10, 5, 0],
  defaultBranchId: "first",
  branches: [
    { id: "first", name: "가상 강남점" },
    { id: "second", name: "가상 성수점" },
  ],
};
beforeEach(() => vi.clearAllMocks());

describe("settings fixed shell and profile", () => {
  it("renders real tab links and fixed card titles before settings load", () => {
    render(
      <>
        <SettingsTabLinks pathname="/settings/account" />
        <SettingsSkeleton tab="account" />
      </>,
    );
    expect(screen.getByRole("link", { name: "계정과 보안" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "프로필" })).toHaveAttribute(
      "href",
      "/settings",
    );
    expect(
      screen.getByRole("heading", { name: "로그인한 기기" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("기기가 없어요")).toBeNull();
  });
  it("optimistically selects a named color, locks repeat submissions and rolls back failure", async () => {
    let finish!: (
      result: ActionResult<{ avatar: Avatar; photo: boolean }>,
    ) => void;
    const save = vi.fn(
      () =>
        new Promise<ActionResult<{ avatar: Avatar; photo: boolean }>>(
          (resolve) => {
            finish = resolve;
          },
        ),
    );
    render(<ProfileSettings data={profile} saveAvatar={save} />);
    const green = screen.getByRole("radio", { name: "초록" });
    fireEvent.click(green);
    fireEvent.click(green);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(green).toBeChecked();
    expect(green).toBeDisabled();
    await act(async () => finish({ ok: false, code: "INTERNAL" }));
    expect(screen.getByRole("radio", { name: "파랑" })).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent("저장하지 못했어요");
  });
  it("saves normalized names and updates the preview without remounting the name input", async () => {
    const save = vi.fn(async () => ({
      ok: true as const,
      data: { name: "박 지훈" },
    }));
    render(<ProfileSettings data={profile} saveName={save} />);
    const input = screen.getByRole("textbox", { name: "이름" });
    fireEvent.change(input, { target: { value: "  박   지훈  " } });
    fireEvent.submit(input.closest("form")!);
    await waitFor(() => expect(save).toHaveBeenCalledWith({ name: "박 지훈" }));
    await waitFor(() => expect(input).toHaveValue("박 지훈"));
    expect(screen.getByRole("textbox", { name: "이름" })).toBe(input);
    expect(
      within(
        screen.getByRole("region", { name: "다른 사람에게 이렇게 보여요" }),
      ).getByRole("heading", { name: "박 지훈" }),
    ).toBeInTheDocument();
    expect(mocks.success).toHaveBeenCalledWith("저장했어요");
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });
  it("connects validation to the input and never offers an unavailable provider photo", async () => {
    const save = vi.fn();
    render(<ProfileSettings data={profile} saveName={save} />);
    const input = screen.getByRole("textbox", { name: "이름" });
    fireEvent.change(input, { target: { value: "  " } });
    fireEvent.submit(input.closest("form")!);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("이름을 입력해 주세요");
    expect(save).not.toHaveBeenCalled();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(
      within(
        screen.getByRole("region", { name: "다른 사람에게 이렇게 보여요" }),
      ).getByRole("button", { name: "설정" }),
    ).toBeDisabled();
  });
  it("offers only the approved provider photo control", () => {
    render(
      <ProfileSettings
        data={{
          ...profile,
          photoProvider: "github",
          photoUrl: "https://avatars.githubusercontent.com/u/1",
        }}
      />,
    );
    expect(
      screen.getByRole("switch", { name: "GitHub 프로필 사진 쓰기" }),
    ).not.toBeChecked();
    expect(
      screen.queryByRole("switch", { name: "Google 프로필 사진 쓰기" }),
    ).toBeNull();
  });
});

describe("account settings", () => {
  it("hides password controls for social-only accounts", () => {
    render(<AccountSettings data={{ ...account, providers: ["github"] }} />);
    expect(
      screen.queryByLabelText("지금 비밀번호", { exact: true }),
    ).toBeNull();
    expect(screen.getByText(/GitHub로 로그인하는 계정/)).toBeInTheDocument();
  });
  it("validates confirmation before calling and clears secrets only on success", async () => {
    const save = vi.fn(async () => ({ ok: true as const, data: {} }));
    render(<AccountSettings data={account} changePassword={save} />);
    const current = screen.getByLabelText("지금 비밀번호", { exact: true });
    const next = screen.getByLabelText("새 비밀번호", { exact: true });
    const confirm = screen.getByLabelText("새 비밀번호 확인", { exact: true });
    fireEvent.change(current, { target: { value: "qwer1234" } });
    fireEvent.change(next, { target: { value: "new-test-password" } });
    fireEvent.change(confirm, { target: { value: "different-password" } });
    fireEvent.submit(current.closest("form")!);
    expect(save).not.toHaveBeenCalled();
    expect(confirm).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(confirm, { target: { value: "new-test-password" } });
    fireEvent.submit(current.closest("form")!);
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith({
        currentPassword: "qwer1234",
        newPassword: "new-test-password",
        confirmPassword: "new-test-password",
        revokeOtherSessions: true,
      }),
    );
    await waitFor(() => expect(current).toHaveValue(""));
    expect(next).toHaveValue("");
    expect(confirm).toHaveValue("");
    expect(mocks.success).toHaveBeenCalledWith("비밀번호를 바꿨어요");
  });
  it("shows a safe wrong-password error while preserving the draft", async () => {
    render(
      <AccountSettings
        data={account}
        changePassword={async () => ({ ok: false, code: "PASSWORD_INCORRECT" })}
      />,
    );
    const current = screen.getByLabelText("지금 비밀번호", { exact: true });
    fireEvent.change(current, { target: { value: "qwer1234" } });
    for (const label of ["새 비밀번호", "새 비밀번호 확인"])
      fireEvent.change(screen.getByLabelText(label, { exact: true }), {
        target: { value: "new-test-password" },
      });
    fireEvent.submit(current.closest("form")!);
    await screen.findByText("지금 비밀번호가 맞지 않아요");
    expect(current).toHaveValue("qwer1234");
    expect(current).toHaveAttribute("aria-invalid", "true");
  });
  it("submits only the selected safe session id and never offers current-session revocation", async () => {
    const revoke = vi.fn(async () => ({ ok: true as const, data: {} }));
    render(<AccountSettings data={account} revokeSession={revoke} />);
    expect(
      screen.queryByRole("button", { name: "Chrome · macOS 로그아웃" }),
    ).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Safari · iOS 로그아웃" }),
    );
    expect(revoke).toHaveBeenCalledWith({ sessionId: "other" });
    expect(mocks.refresh).toHaveBeenCalled();
  });
});

describe("preference settings", () => {
  it("renders the selected branch label before client interaction", () => {
    render(<PreferenceSettings data={preferences} />);
    expect(
      screen.getByRole("combobox", { name: "기본 지점" }),
    ).toHaveTextContent("가상 강남점");
  });
  it("saves switches once, updates chat cache and rolls back rejected changes", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(CHAT_NAV_KEY, { chatToasts: true, tabBadge: true });
    const save = vi.fn(async () => ({
      ok: true as const,
      data: {
        chatToasts: false,
        tabBadge: true,
        reminderMinutes: [30, 10, 5, 0],
      },
    }));
    const view = render(
      <QueryClientProvider client={client}>
        <PreferenceSettings data={preferences} save={save} />
      </QueryClientProvider>,
    );
    await userEvent.click(
      screen.getByRole("switch", { name: "멘션과 DM 토스트" }),
    );
    expect(save).toHaveBeenCalledWith({ chatToasts: false });
    expect(client.getQueryData(CHAT_NAV_KEY)).toMatchObject({
      chatToasts: false,
    });
    view.unmount();
    render(
      <PreferenceSettings
        data={preferences}
        save={async () => ({ ok: false, code: "INTERNAL" })}
      />,
    );
    await userEvent.click(screen.getByRole("switch", { name: "30분 전" }));
    await screen.findByRole("alert");
    expect(screen.getByRole("switch", { name: "30분 전" })).toBeChecked();
  });
  it("allows all reminders off without claiming missing notifications", async () => {
    const save = vi.fn(async () => ({
      ok: true as const,
      data: { chatToasts: true, tabBadge: true, reminderMinutes: [] },
    }));
    render(
      <PreferenceSettings
        data={{ ...preferences, reminderMinutes: [0] }}
        save={save}
      />,
    );
    await userEvent.click(screen.getByRole("switch", { name: "시작할 때" }));
    expect(save).toHaveBeenCalledWith({ reminderMinutes: [] });
    expect(screen.getByRole("switch", { name: "시작할 때" })).not.toBeChecked();
  });
});
