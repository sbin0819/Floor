import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelDialog } from "@/features/chat/components/channel-dialog";
import {
  SpaceDanger,
  SpaceOverview,
} from "@/features/chat/components/space-settings";
import { spaceSettingsTabs } from "@/features/chat/space-settings";
import { SpaceInvitesList } from "@/features/chat/components/space-invites-list";
import { ChatMuteButton } from "@/features/chat/components/chat-mute-button";
import type { SpaceSettings } from "@/features/chat/space-settings-queries";
import type { SpaceInviteItem } from "@/features/chat/space-invite-queries";
import type { ActionResult } from "@/lib/actions/result";
import { CHAT_NAV_KEY } from "@/features/chat/nav-state";

const spaceId = "11111111-1111-4111-8111-111111111111";
const roomId = "22222222-2222-4222-8222-222222222222";
const mocks = vi.hoisted(() => ({
  pathname: "",
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  archive: vi.fn(),
  updateSpace: vi.fn(),
  revoke: vi.fn(),
  mute: vi.fn(),
  remove: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks,
  usePathname: () => mocks.pathname,
}));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));
vi.mock("@/features/chat/space-actions", () => ({
  createChannel: mocks.create,
  updateChannel: mocks.update,
  archiveChannel: mocks.archive,
  updateSpace: mocks.updateSpace,
  revokeInvite: mocks.revoke,
  deleteSpace: mocks.remove,
}));
vi.mock("@/features/chat/actions", () => ({
  setRoomMuted: mocks.mute,
  setSpaceMuted: mocks.mute,
}));

const channel = {
  id: roomId,
  name: "공지",
  topic: "이용 안내",
  adminOnly: true,
};
const space = (overrides: Partial<SpaceSettings> = {}): SpaceSettings => ({
  id: spaceId,
  kind: "community",
  name: "주말 모임",
  iconColor: "green",
  role: "owner",
  channels: [channel],
  ...overrides,
});
function mount(node: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const wrap = (content: ReactNode) => (
    <QueryClientProvider client={client}>{content}</QueryClientProvider>
  );
  return { ...render(wrap(node)), wrap, invalidate };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.pathname = `/s/${spaceId}/settings`;
  mocks.create.mockResolvedValue({ ok: true, data: { roomId } });
  for (const action of [
    mocks.update,
    mocks.archive,
    mocks.updateSpace,
    mocks.revoke,
    mocks.mute,
    mocks.remove,
  ])
    action.mockResolvedValue({ ok: true, data: {} });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("channel settings controls", () => {
  it("previews NFC, case and dash normalization while preserving the server-validated input", async () => {
    const user = userEvent.setup();
    mount(<ChannelDialog spaceId={spaceId} />);
    await user.click(screen.getByRole("button", { name: "채널 만들기" }));
    const input = screen.getByRole("textbox", { name: "채널 이름" });
    const name = "  \u1100\u1161  ABC -- 자료  ";
    fireEvent.change(input, { target: { value: name } });
    const preview = screen.getByText("# 가-abc-자료");
    expect(input).toHaveAttribute("aria-describedby", preview.id);
    fireEvent.change(screen.getByRole("textbox", { name: "주제" }), {
      target: { value: "새 이야기" },
    });
    await user.click(screen.getByRole("switch", { name: "관리자만 쓰기" }));
    await user.click(screen.getByRole("button", { name: "만들기" }));
    await waitFor(() =>
      expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
        spaceId,
        name,
        topic: "새 이야기",
        adminOnly: true,
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith(`/s/${spaceId}/${roomId}`);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it.each(["", "---", "가".repeat(31), "general!", "모임😀"])(
    "disables an invalid channel name %s",
    async (name) => {
      const user = userEvent.setup();
      mount(<ChannelDialog spaceId={spaceId} />);
      await user.click(screen.getByRole("button", { name: "채널 만들기" }));
      fireEvent.change(screen.getByLabelText("채널 이름"), {
        target: { value: name },
      });
      expect(screen.getByRole("button", { name: "만들기" })).toBeDisabled();
      fireEvent.submit(screen.getByLabelText("채널 이름").closest("form")!);
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it.each([
    [{ ok: false, code: "CHANNEL_NAME_TAKEN" }, "같은 이름의 채널이 있어요"],
    [
      { ok: false, code: "LIMIT_EXCEEDED", message: "channel_count" },
      "채널은 50개까지 만들 수 있어요",
    ],
  ] as const)(
    "keeps a draft and shows the safe server error %s",
    async (result, text) => {
      mocks.create.mockResolvedValue(result);
      const user = userEvent.setup();
      mount(<ChannelDialog spaceId={spaceId} />);
      await user.click(screen.getByRole("button", { name: "채널 만들기" }));
      await user.type(screen.getByLabelText("채널 이름"), "새 채널");
      await user.click(screen.getByRole("button", { name: "만들기" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(text);
      expect(screen.getByLabelText("채널 이름")).toHaveValue("새 채널");
      expect(screen.getByRole("dialog")).toBeVisible();
      expect(mocks.push).not.toHaveBeenCalled();
      expect(mocks.refresh).not.toHaveBeenCalled();
    },
  );
  it("prevents rapid duplicate creation while the action is pending", async () => {
    const pending = Promise.withResolvers<ActionResult<{ roomId: string }>>();
    mocks.create.mockReturnValue(pending.promise);
    const user = userEvent.setup();
    mount(<ChannelDialog spaceId={spaceId} />);
    await user.click(screen.getByRole("button", { name: "채널 만들기" }));
    fireEvent.change(screen.getByLabelText("채널 이름"), {
      target: { value: "채널" },
    });
    const form = screen.getByLabelText("채널 이름").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(mocks.create).toHaveBeenCalledOnce());
    expect(screen.getByRole("button", { name: "만들기" })).toBeDisabled();
    await act(async () => pending.resolve({ ok: true, data: { roomId } }));
    expect(mocks.create).toHaveBeenCalledOnce();
  });
  it("uses the authorized current settings immediately and preserves the route on edit", async () => {
    const user = userEvent.setup();
    mount(<ChannelDialog spaceId={spaceId} channel={channel} />);
    await user.click(screen.getByRole("button", { name: "공지 채널 설정" }));
    expect(screen.getByLabelText("채널 이름")).toHaveValue("공지");
    expect(screen.getByLabelText("주제")).toHaveValue("이용 안내");
    expect(screen.getByRole("switch", { name: "관리자만 쓰기" })).toBeChecked();
    await user.clear(screen.getByLabelText("주제"));
    await user.click(screen.getByRole("switch", { name: "관리자만 쓰기" }));
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledExactlyOnceWith({
        roomId,
        name: "공지",
        topic: "",
        adminOnly: false,
      }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("disables overlong topics with a connected invalid state", async () => {
    const user = userEvent.setup();
    mount(<ChannelDialog spaceId={spaceId} channel={channel} />);
    await user.click(screen.getByRole("button", { name: "공지 채널 설정" }));
    fireEvent.change(screen.getByLabelText("주제"), {
      target: { value: "가".repeat(201) },
    });
    expect(screen.getByLabelText("주제")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
  });
  it("closes a route-driven edit without replacing a different route after navigation", async () => {
    const user = userEvent.setup();
    const props = {
      spaceId,
      channel,
      returnHref: `/s/${spaceId}/settings?tab=overview`,
    };
    const result = mount(<ChannelDialog {...props} />);
    expect(screen.getByLabelText("채널 이름")).toHaveValue("공지");
    mocks.pathname = "/bookings";
    result.rerender(result.wrap(<ChannelDialog {...props} />));
    await user.click(screen.getByRole("button", { name: "돌아가기" }));
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});

describe("space overview", () => {
  it("renders owner values and accessible current color in SSR before any action", () => {
    const client = new QueryClient();
    const html = renderToString(
      <QueryClientProvider client={client}>
        <SpaceOverview space={space({ channels: [] })} />
      </QueryClientProvider>,
    );
    expect(html).toContain('value="주말 모임"');
    expect(html).toContain('aria-label="초록"');
    expect(html).toContain('aria-checked="true"');
    expect(mocks.updateSpace).not.toHaveBeenCalled();
  });
  it("lets only community owners save a valid name and selected color", async () => {
    const user = userEvent.setup();
    const { invalidate } = mount(
      <SpaceOverview space={space({ channels: [] })} />,
    );
    await user.clear(screen.getByRole("textbox", { name: "이름" }));
    expect(screen.getByRole("button", { name: "저장" })).toBeDisabled();
    await user.type(screen.getByRole("textbox", { name: "이름" }), "새 모임");
    await user.click(screen.getByRole("radio", { name: "보라" }));
    await user.click(screen.getByRole("button", { name: "저장" }));
    await waitFor(() =>
      expect(mocks.updateSpace).toHaveBeenCalledExactlyOnceWith({
        spaceId,
        name: "새 모임",
        iconColor: "purple",
      }),
    );
    expect(invalidate).toHaveBeenCalledWith({ queryKey: CHAT_NAV_KEY });
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it.each(["member", "admin"] as const)(
    "does not offer name/color editing to a community %s",
    (role) => {
      mount(<SpaceOverview space={space({ role, channels: [] })} />);
      expect(screen.getByText("주말 모임")).toBeVisible();
      expect(screen.getByText("색: 초록")).toBeVisible();
      expect(
        screen.queryByRole("textbox", { name: "이름" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole("radio")).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "저장" }),
      ).not.toBeInTheDocument();
    },
  );
  it("keeps team naming read-only with a team management link even for its admin", () => {
    mount(
      <SpaceOverview
        space={space({
          kind: "team",
          role: "admin",
          name: "가상팀",
          channels: [],
        })}
      />,
    );
    expect(screen.getByRole("link", { name: "팀 관리" })).toHaveAttribute(
      "href",
      "/teams",
    );
    expect(screen.getByText(/팀 이름은/)).toHaveTextContent(
      "팀 이름은 팀 관리에서 바꿔요",
    );
    expect(
      screen.queryByRole("textbox", { name: "이름" }),
    ).not.toBeInTheDocument();
  });
  it("shows a lounge name and hides management controls from ordinary members", () => {
    mount(
      <SpaceOverview
        space={space({ kind: "branch", role: "member", name: "가상 강남점" })}
      />,
    );
    expect(screen.getByText("가상 강남점")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "채널 만들기" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "공지 채널 설정" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "보관" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "# 공지" })).toHaveAttribute(
      "href",
      `/s/${spaceId}/${roomId}`,
    );
  });
  it("provides the same empty-channel copy and creation only for an admin", () => {
    const result = mount(
      <SpaceOverview space={space({ channels: [], role: "member" })} />,
    );
    expect(screen.getByText("텍스트 채널이 없어요")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "채널 만들기" }),
    ).not.toBeInTheDocument();
    result.rerender(
      result.wrap(
        <SpaceOverview space={space({ channels: [], role: "admin" })} />,
      ),
    );
    expect(screen.getByRole("button", { name: "채널 만들기" })).toBeEnabled();
  });
});

describe("space settings tabs and danger actions", () => {
  it("limits settings tabs by role and space type", () => {
    expect(
      spaceSettingsTabs({ kind: "branch", role: "admin" }).map(
        ({ key }) => key,
      ),
    ).toEqual(["overview", "members", "banned"]);
    expect(
      spaceSettingsTabs({ kind: "community", role: "member" }).map(
        ({ key }) => key,
      ),
    ).toEqual(["overview", "members", "invites"]);
    expect(
      spaceSettingsTabs({ kind: "community", role: "owner" }).map(
        ({ key }) => key,
      ),
    ).toEqual(["overview", "members", "invites", "banned", "danger"]);
  });
  it("requires exact name before deleting a community", async () => {
    const user = userEvent.setup();
    mocks.remove.mockResolvedValue({ ok: true, data: {} });
    const space: SpaceSettings = {
      id: spaceId,
      name: "모임",
      kind: "community",
      iconColor: "blue",
      role: "owner",
      channels: [],
    };
    mount(<SpaceDanger space={space} />);
    await user.click(screen.getByRole("button", { name: "스페이스 지우기" }));
    expect(screen.getByRole("button", { name: "지우기" })).toBeDisabled();
    await user.type(screen.getByLabelText("확인 이름"), "모임");
    await user.click(screen.getByRole("button", { name: "지우기" }));
    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({
        spaceId,
        confirmName: "모임",
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith("/messages");
  });
});

describe("channel menu to archive dialog", () => {
  it("shows management only with authorized management props", async () => {
    const user = userEvent.setup();
    mount(<ChatMuteButton id={roomId} name="공지" muted={false} />);
    await user.click(screen.getByRole("button", { name: "공지 알림 설정" }));
    expect(screen.getByRole("menuitem", { name: "알림 끄기" })).toBeVisible();
    expect(
      screen.queryByRole("menuitem", { name: "채널 설정" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: "보관" }),
    ).not.toBeInTheDocument();
  });
  it("keeps focus inside confirmation and returns it to the persistent menu trigger on cancel", async () => {
    const user = userEvent.setup();
    mount(
      <ChatMuteButton
        id={roomId}
        name="공지"
        muted={false}
        manageSpaceId={spaceId}
      />,
    );
    const trigger = screen.getByRole("button", { name: "공지 알림 설정" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("menuitem", { name: "채널 설정" })).toHaveAttribute(
      "href",
      `/s/${spaceId}/settings?channel=${roomId}`,
    );
    await user.click(screen.getByRole("menuitem", { name: "보관" }));
    const dialog = await screen.findByRole("dialog", {
      name: "공지 채널을 보관할까요?",
    });
    await waitFor(() =>
      expect(dialog.contains(document.activeElement)).toBe(true),
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(mocks.archive).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(trigger).toHaveFocus());
  });
  it("keeps failure inside confirmation, then archives once and restores focus", async () => {
    mocks.archive
      .mockResolvedValueOnce({ ok: false, code: "FORBIDDEN" })
      .mockResolvedValueOnce({ ok: true, data: {} });
    const user = userEvent.setup();
    mount(
      <ChatMuteButton
        id={roomId}
        name="공지"
        muted={false}
        manageSpaceId={spaceId}
      />,
    );
    const trigger = screen.getByRole("button", { name: "공지 알림 설정" });
    await user.click(trigger);
    await user.click(screen.getByRole("menuitem", { name: "보관" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "보관" }));
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "이 작업을 할 수 없어요",
    );
    expect(mocks.refresh).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "보관" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(mocks.archive).toHaveBeenNthCalledWith(2, { roomId });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe("space invitation management", () => {
  const ownCode = "a".repeat(22),
    foreignCode = "b".repeat(22);
  const rows: SpaceInviteItem[] = [
    {
      createdByAvatar: { color: "blue" as const, photoUrl: null },
      inviteId: roomId,
      codePrefix: ownCode.slice(0, 6),
      code: ownCode,
      createdByName: "김하은",
      expiresAt: null,
      useCount: 2,
      maxUses: 10,
    },
    {
      createdByAvatar: { color: "blue" as const, photoUrl: null },
      inviteId: "33333333-3333-4333-8333-333333333333",
      codePrefix: foreignCode.slice(0, 6),
      createdByName: "이도윤",
      expiresAt: "2026-10-15T09:00:00.000Z",
      useCount: 0,
      maxUses: null,
    },
  ];
  it("renders the server-authorized prefix and own full code without inventing a foreign link", () => {
    mount(<SpaceInvitesList rows={rows} />);
    expect(screen.getByText("aaaaaa… · 김하은")).toBeVisible();
    expect(screen.getByText("bbbbbb… · 이도윤")).toBeVisible();
    expect(screen.getByText(`/s/join/${ownCode}`)).toBeVisible();
    expect(
      screen.queryByText(`/s/join/${foreignCode}`),
    ).not.toBeInTheDocument();
    expect(screen.getByText("사용 2 / 10 · 만료 없음")).toBeVisible();
    expect(
      screen.getByText("사용 0 / 제한 없음 · 만료 2026-10-15"),
    ).toBeVisible();
    expect(screen.getAllByRole("button", { name: "끊기" })).toHaveLength(2);
  });
  it("does not expose prior rows after the server returns a narrower member DTO", () => {
    const result = mount(<SpaceInvitesList rows={rows} />);
    result.rerender(result.wrap(<SpaceInvitesList rows={[rows[0]!]} />));
    expect(screen.queryByText(/이도윤/)).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "끊기" })).toHaveLength(1);
  });
  it("retains a link after revoke failure and only refreshes after success", async () => {
    mocks.revoke
      .mockResolvedValueOnce({ ok: false, code: "FORBIDDEN" })
      .mockResolvedValueOnce({ ok: true, data: {} });
    const user = userEvent.setup();
    const { invalidate } = mount(<SpaceInvitesList rows={[rows[0]!]} />);
    await user.click(screen.getByRole("button", { name: "끊기" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "이 작업을 할 수 없어요",
    );
    expect(screen.getByText(`/s/join/${ownCode}`)).toBeVisible();
    expect(mocks.refresh).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "끊기" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    expect(mocks.revoke).toHaveBeenNthCalledWith(2, { inviteId: roomId });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: CHAT_NAV_KEY });
  });
  it("shows an empty state without a revoke control", () => {
    mount(<SpaceInvitesList rows={[]} />);
    expect(screen.getByText("사용할 수 있는 초대 링크가 없어요")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "끊기" }),
    ).not.toBeInTheDocument();
  });
});
