import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SpaceMembers } from "@/features/chat/components/space-members";
import {
  banSpaceMember,
  setSpaceAdmin,
  transferSpaceOwnership,
  unbanSpaceMember,
} from "@/features/chat/space-actions";
import type {
  SpaceMember,
  SpaceMembersView,
} from "@/features/chat/space-members-queries";

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/features/chat/space-actions", () => ({
  banSpaceMember: vi.fn(),
  setSpaceAdmin: vi.fn(),
  transferSpaceOwnership: vi.fn(),
  unbanSpaceMember: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn() } }));
const spaceId = "10000000-0000-4000-8000-000000000001";
const owner: SpaceMember = {
  avatar: { color: "blue" as const, photoUrl: null },
  userId: "20000000-0000-4000-8000-000000000001",
  name: "최하은",
  username: "haeun",
  role: "owner",
  sharesSpace: true,
};
const admin: SpaceMember = {
  avatar: { color: "blue" as const, photoUrl: null },
  userId: "20000000-0000-4000-8000-000000000002",
  name: "김민준",
  username: "minjun",
  role: "admin",
  sharesSpace: true,
};
const member: SpaceMember = {
  avatar: { color: "blue" as const, photoUrl: null },
  userId: "20000000-0000-4000-8000-000000000003",
  name: "박서연",
  username: null,
  role: "member",
  sharesSpace: true,
};
const removed: SpaceMember = {
  avatar: { color: "blue" as const, photoUrl: null },
  userId: "20000000-0000-4000-8000-000000000004",
  name: "이도윤",
  username: "doyun",
  role: "member",
  sharesSpace: false,
};
function fixture(
  role: "owner" | "admin" | "member" = "owner",
  kind: "team" | "branch" | "community" = "community",
): SpaceMembersView {
  return {
    view: "full",
    space: { id: spaceId, kind, name: "가상 모임", iconColor: "blue", role },
    memberCount: 3,
    members: [owner, admin, member],
    banned: [removed],
  };
}
function mount(data = fixture(), currentUserId = owner.userId, banned = false) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <SpaceMembers data={data} currentUserId={currentUserId} banned={banned} />
    </QueryClientProvider>,
  );
}
const row = (name: string) =>
  screen.getByRole("button", { name: `${name} 프로필` }).closest("li")!;
beforeEach(() => {
  vi.resetAllMocks();
  for (const action of [
    banSpaceMember,
    setSpaceAdmin,
    transferSpaceOwnership,
    unbanSpaceMember,
  ])
    vi.mocked(action).mockResolvedValue({ ok: true, data: {} });
});
afterEach(() => vi.unstubAllGlobals());

describe("space member settings", () => {
  it("keeps the server's member order, Korean role badges and nullable usernames without fetching", () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    mount();
    expect(screen.getByRole("heading", { name: "멤버 3명" })).toBeVisible();
    const rows = within(
      screen.getByRole("list", { name: "멤버 목록" }),
    ).getAllByRole("listitem");
    expect(
      rows.map((item) =>
        within(item)
          .getByRole("button", { name: /프로필/ })
          .getAttribute("aria-label"),
      ),
    ).toEqual(["최하은 프로필", "김민준 프로필", "박서연 프로필"]);
    expect(within(row(owner.name)).getByText("소유자")).toBeVisible();
    expect(within(row(admin.name)).getByText("관리자")).toBeVisible();
    expect(screen.getByText("@haeun")).toBeVisible();
    expect(within(row(member.name)).queryByText(/^@/)).not.toBeInTheDocument();
    expect(screen.queryByText(removed.name)).not.toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("shows only the count and provided administrators in a limited lounge view", () => {
    mount(
      {
        view: "limited",
        space: { ...fixture().space, kind: "branch", role: "member" },
        memberCount: 120,
        admins: [{ ...admin, sharesSpace: false }],
      },
      member.userId,
    );
    expect(screen.getByRole("heading", { name: "멤버 120명" })).toBeVisible();
    expect(screen.getByRole("list", { name: "관리자 목록" })).toBeVisible();
    expect(
      screen.getByText("라운지에서는 관리자 목록만 볼 수 있어요"),
    ).toBeVisible();
    expect(screen.queryByText(owner.name)).not.toBeInTheDocument();
    expect(screen.queryByText(member.name)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByText(/온라인|자리 비움/)).not.toBeInTheDocument();
  });

  it.each(["team", "branch"] as const)(
    "does not offer community writes to a %s administrator",
    (kind) => {
      mount(fixture("admin", kind), admin.userId);
      expect(screen.getAllByRole("button")).toHaveLength(3);
      expect(
        screen.queryByRole("button", { name: "내보내기" }),
      ).not.toBeInTheDocument();
    },
  );

  it("limits an administrator to removing other ordinary members", () => {
    mount(fixture("admin"), admin.userId);
    expect(
      within(row(member.name)).getByRole("button", { name: "내보내기" }),
    ).toBeVisible();
    expect(within(row(admin.name)).getAllByRole("button")).toHaveLength(1);
    expect(within(row(owner.name)).getAllByRole("button")).toHaveLength(1);
    expect(
      screen.queryByRole("button", { name: "소유권 넘기기" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "관리자로 정하기" }),
    ).not.toBeInTheDocument();
  });

  it("never offers a member management buttons, including for themselves", () => {
    mount(fixture("member"), member.userId);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("lets the owner promote or demote peers without changing the owner's own row", async () => {
    mount();
    expect(within(row(owner.name)).getAllByRole("button")).toHaveLength(1);
    fireEvent.click(
      within(row(member.name)).getByRole("button", { name: "관리자로 정하기" }),
    );
    await waitFor(() =>
      expect(setSpaceAdmin).toHaveBeenCalledExactlyOnceWith({
        spaceId,
        userId: member.userId,
        admin: true,
      }),
    );
    fireEvent.click(
      within(row(admin.name)).getByRole("button", { name: "관리자 풀기" }),
    );
    await waitFor(() =>
      expect(setSpaceAdmin).toHaveBeenNthCalledWith(2, {
        spaceId,
        userId: admin.userId,
        admin: false,
      }),
    );
    expect(router.refresh).toHaveBeenCalledTimes(2);
  });

  it("requires confirmation before transferring ownership and restores trigger focus", async () => {
    const user = userEvent.setup();
    mount();
    const trigger = within(row(member.name)).getByRole("button", {
      name: "소유권 넘기기",
    });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", {
      name: "박서연 님에게 소유권을 넘길까요?",
    });
    expect(
      within(dialog).getByText("이 사람은 소유자가 되고, 나는 관리자가 돼요"),
    ).toBeVisible();
    expect(transferSpaceOwnership).not.toHaveBeenCalled();
    await user.click(
      within(dialog).getByRole("button", { name: "소유권 넘기기" }),
    );
    await waitFor(() =>
      expect(transferSpaceOwnership).toHaveBeenCalledExactlyOnceWith({
        spaceId,
        userId: member.userId,
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it("explains that removal blocks re-entry and submits only after confirmation", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(
      within(row(admin.name)).getByRole("button", { name: "내보내기" }),
    );
    const dialog = screen.getByRole("dialog", {
      name: "김민준 님을 내보낼까요?",
    });
    expect(
      within(dialog).getByText("다시 들어오려면 관리자가 풀어 줘야 해요"),
    ).toBeVisible();
    expect(banSpaceMember).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "내보내기" }));
    await waitFor(() =>
      expect(banSpaceMember).toHaveBeenCalledExactlyOnceWith({
        spaceId,
        userId: admin.userId,
      }),
    );
  });

  it.each(["owner", "admin"] as const)(
    "lets a community %s lift a ban without rendering active members",
    async (role) => {
      mount(
        fixture(role),
        role === "owner" ? owner.userId : admin.userId,
        true,
      );
      expect(
        screen.getByRole("heading", { name: "들어올 수 없는 사람" }),
      ).toBeVisible();
      expect(screen.queryByText(owner.name)).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "내보내기" }),
      ).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "풀어 주기" }));
      await waitFor(() =>
        expect(unbanSpaceMember).toHaveBeenCalledExactlyOnceWith({
          spaceId,
          userId: removed.userId,
        }),
      );
    },
  );

  it.each([
    fixture("member"),
    fixture("member", "branch"),
    fixture("admin", "team"),
  ])(
    "does not render a banned tab outside its authorized management scope",
    (data) => {
      const { container } = mount(data, member.userId, true);
      expect(container).toBeEmptyDOMElement();
    },
  );

  it("prevents duplicate unbans and keeps a safe failure available for retry", async () => {
    let resolve!: (
      result: Awaited<ReturnType<typeof unbanSpaceMember>>,
    ) => void;
    vi.mocked(unbanSpaceMember).mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    mount(fixture(), owner.userId, true);
    const button = screen.getByRole("button", { name: "풀어 주기" });
    act(() => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    await waitFor(() => expect(unbanSpaceMember).toHaveBeenCalledOnce());
    expect(button).toBeDisabled();
    await act(async () =>
      resolve({ ok: false, code: "FORBIDDEN", message: "private reason" }),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "이 작업을 할 권한이 없어요",
    );
    expect(screen.queryByText("private reason")).not.toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
    expect(button).toBeEnabled();
  });

  it("opens the existing profile lazily from the member row without a new endpoint", async () => {
    const fetch = vi.fn(async () =>
      Response.json({
        userId: owner.userId,
        avatar: owner.avatar,
        name: owner.name,
        username: owner.username,
        isMe: true,
        relation: null,
        sharedSpaces: [],
        directRoomId: null,
        canDirectMessage: false,
      }),
    );
    vi.stubGlobal("fetch", fetch);
    mount();
    expect(fetch).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: `${owner.name} 프로필` }),
    );
    await waitFor(() =>
      expect(fetch).toHaveBeenCalledExactlyOnceWith(
        `/api/people/${owner.userId}`,
        expect.objectContaining({
          signal: expect.any(AbortSignal),
          cache: "no-store",
          credentials: "same-origin",
          method: "GET",
        }),
      ),
    );
    expect(
      await screen.findByRole("heading", { name: owner.name }),
    ).toBeVisible();
  });

  it.each([false, true])(
    "shows an honest empty state for banned=%s",
    (banned) => {
      mount(
        { ...fixture(), view: "full", members: [], banned: [], memberCount: 0 },
        owner.userId,
        banned,
      );
      expect(
        screen.getByText(
          banned ? "들어올 수 없는 사람이 없어요" : "아직 멤버가 없어요",
        ),
      ).toBeVisible();
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
    },
  );
});
