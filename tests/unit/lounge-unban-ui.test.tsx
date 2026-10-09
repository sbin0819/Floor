import { Activity } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpaceMembers } from "@/features/chat/components/space-members";
import { spaceSettingsTabs } from "@/features/chat/space-settings";
import { unbanSpaceMember } from "@/features/chat/space-actions";
import type {
  SpaceMember,
  SpaceMembersView,
} from "@/features/chat/space-members-queries";
import { CHAT_NAV_KEY } from "@/features/chat/nav-state";

const mocks = vi.hoisted(() => ({ refresh: vi.fn(), success: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
}));
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));
vi.mock("@/features/chat/space-actions", () => ({
  unbanSpaceMember: vi.fn(),
  banSpaceMember: vi.fn(),
  setSpaceAdmin: vi.fn(),
  transferSpaceOwnership: vi.fn(),
}));
const spaceId = "40000000-0000-4000-8000-000000000001";
const currentUserId = "40000000-0000-4000-8000-000000000002";
const active: SpaceMember = {
  userId: currentUserId,
  name: "김도윤",
  username: "doyun",
  role: "admin",
  avatar: { color: "blue", photoUrl: null },
  sharesSpace: true,
};
const removed: SpaceMember = {
  userId: "40000000-0000-4000-8000-000000000003",
  name: "김하은",
  username: "haeun",
  role: "member",
  avatar: { color: "pink", photoUrl: null },
  sharesSpace: false,
};
type FullView = Extract<SpaceMembersView, { view: "full" }>;
function fixture(
  kind: FullView["space"]["kind"] = "branch",
  role: FullView["space"]["role"] = "admin",
): FullView {
  return {
    view: "full",
    space: { id: spaceId, kind, role, name: "강남점", iconColor: "blue" },
    members: [active],
    banned: [removed],
    memberCount: 12,
  };
}
const clients: QueryClient[] = [];
function mount(data: SpaceMembersView = fixture(), banned = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  const frame = (next: SpaceMembersView, hidden = false) => (
    <QueryClientProvider client={client}>
      <Activity mode={hidden ? "hidden" : "visible"}>
        <SpaceMembers
          data={next}
          currentUserId={currentUserId}
          banned={banned}
        />
      </Activity>
    </QueryClientProvider>
  );
  return { ...render(frame(data)), client, frame };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(unbanSpaceMember).mockResolvedValue({ ok: true, data: {} });
  vi.stubGlobal("fetch", vi.fn());
});
afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

describe("lounge unban UI", () => {
  it("adds only the lounge administrator's banned tab, without community-only controls", () => {
    expect(spaceSettingsTabs({ kind: "branch", role: "admin" })).toEqual([
      { key: "overview", name: "개요" },
      { key: "members", name: "멤버" },
      { key: "banned", name: "내보낸 사람" },
    ]);
    expect(
      spaceSettingsTabs({ kind: "branch", role: "member" }).map(
        ({ key }) => key,
      ),
    ).toEqual(["overview", "members"]);
    expect(
      spaceSettingsTabs({ kind: "team", role: "admin" }).map(({ key }) => key),
    ).toEqual(["overview", "members"]);
  });
  it.each(["owner", "admin"] as const)(
    "keeps the community %s tab and action labels unchanged",
    (role) => {
      expect(spaceSettingsTabs({ kind: "community", role })).toContainEqual({
        key: "banned",
        name: "들어올 수 없는 사람",
      });
      mount(fixture("community", role));
      expect(
        screen.getByRole("heading", { name: "들어올 수 없는 사람" }),
      ).toBeVisible();
      expect(screen.getByRole("button", { name: "풀어 주기" })).toBeVisible();
      expect(
        screen.queryByRole("button", { name: "풀기" }),
      ).not.toBeInTheDocument();
    },
  );
  it("renders only banned people for a full lounge administrator without fetching profiles", () => {
    mount();
    expect(screen.getByRole("heading", { name: "내보낸 사람" })).toBeVisible();
    const list = screen.getByRole("list", { name: "내보낸 사람 목록" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(
      within(list).getByRole("button", { name: "김하은 프로필" }),
    ).toBeVisible();
    expect(screen.getByText("@haeun")).toBeVisible();
    expect(screen.queryByText(active.name)).not.toBeInTheDocument();
    for (const name of ["내보내기", "관리자로 정하기", "소유권 넘기기"])
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    fixture("branch", "member"),
    fixture("team", "admin"),
    { ...fixture(), view: "limited" as const, admins: [active] },
    {
      ...fixture("branch", "member"),
      view: "limited" as const,
      admins: [active],
    },
  ])(
    "does not expose banned people outside the full administrator view",
    (data) => {
      const { container } = mount(data);
      expect(container).toBeEmptyDOMElement();
      expect(fetch).not.toHaveBeenCalled();
      expect(unbanSpaceMember).not.toHaveBeenCalled();
    },
  );
  it("preserves the limited ordinary-member page with administrator names only", () => {
    mount(
      {
        space: fixture("branch", "member").space,
        memberCount: 12,
        view: "limited",
        admins: [active],
      },
      false,
    );
    expect(screen.getByRole("heading", { name: "멤버 12명" })).toBeVisible();
    expect(screen.getByRole("list", { name: "관리자 목록" })).toHaveTextContent(
      active.name,
    );
    expect(screen.queryByText(removed.name)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "풀기" }),
    ).not.toBeInTheDocument();
  });
  it("unbans by keyboard with one action argument and refreshes the existing navigation", async () => {
    const user = userEvent.setup();
    const { client, rerender, frame } = mount();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const button = screen.getByRole("button", { name: "풀기" });
    button.focus();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(unbanSpaceMember).toHaveBeenCalledExactlyOnceWith({
        spaceId,
        userId: removed.userId,
      }),
    );
    expect(vi.mocked(unbanSpaceMember).mock.calls[0]).toHaveLength(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: CHAT_NAV_KEY });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(mocks.success).toHaveBeenCalledWith("다시 들어올 수 있게 했어요");
    rerender(frame({ ...fixture(), banned: [] }));
    expect(screen.getByText("내보낸 사람이 없어요")).toBeVisible();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
  it("blocks duplicate unbans and preserves the person with a sanitized retryable failure", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof unbanSpaceMember>>) => void;
    vi.mocked(unbanSpaceMember).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    mount();
    const button = screen.getByRole("button", { name: "풀기" });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await waitFor(() => expect(unbanSpaceMember).toHaveBeenCalledOnce());
    expect(button).toBeDisabled();
    await act(async () =>
      resolve({ ok: false, code: "FORBIDDEN", message: "private failure" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "이 작업을 할 수 없어요",
    );
    expect(screen.queryByText("private failure")).not.toBeInTheDocument();
    expect(screen.getByText(removed.name)).toBeVisible();
    expect(button).toBeEnabled();
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });
  it("ignores a completed unban after Activity hides the member screen", async () => {
    let resolve!: (value: Awaited<ReturnType<typeof unbanSpaceMember>>) => void;
    vi.mocked(unbanSpaceMember).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { rerender, frame } = mount();
    fireEvent.click(screen.getByRole("button", { name: "풀기" }));
    await waitFor(() => expect(unbanSpaceMember).toHaveBeenCalledOnce());
    rerender(frame(fixture(), true));
    await act(async () => resolve({ ok: true, data: {} }));
    expect(mocks.refresh).not.toHaveBeenCalled();
    expect(mocks.success).not.toHaveBeenCalled();
  });
});
