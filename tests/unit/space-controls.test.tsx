import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CreateSpaceForm,
  SpaceAdd,
  inviteCodeFromInput,
} from "@/features/chat/components/space-add";
import { SpaceJoin } from "@/features/chat/components/space-join";
import {
  InviteLinkForm,
  SpaceInviteDialog,
} from "@/features/chat/components/space-invite-dialog";
import { SpaceMenu } from "@/features/chat/components/space-menu";
import { spaceActionMessage } from "@/features/chat/components/use-space-mutation";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
  remove: vi.fn(),
  invite: vi.fn(),
  leave: vi.fn(),
  success: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => mocks,
  usePathname: () => "/s/space/settings",
}));
vi.mock("@/features/chat/space-actions", () => ({
  createCommunitySpace: vi.fn(),
  joinSpaceByInvite: vi.fn(),
  createInviteLink: vi.fn(),
  inviteToSpace: mocks.invite,
  leaveSpace: mocks.leave,
  createChannel: vi.fn(),
  updateChannel: vi.fn(),
  archiveChannel: vi.fn(),
  updateSpace: vi.fn(),
  deleteSpace: mocks.remove,
}));
vi.mock("@/features/chat/actions", () => ({ setSpaceMuted: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { success: mocks.success, error: vi.fn() },
}));
const spaceId = "11111111-1111-4111-8111-111111111111",
  roomId = "22222222-2222-4222-8222-222222222222";
function mount(node: ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {node}
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

describe("space controls", () => {
  it.each([
    "a".repeat(22),
    `/s/join/${"a".repeat(22)}`,
    `https://floor.example/s/join/${"a".repeat(22)}?from=chat`,
  ])(
    "accepts a valid code or link without navigating outside the app",
    (input) => expect(inviteCodeFromInput(input)).toBe("a".repeat(22)),
  );
  it.each([
    "",
    "javascript:alert(1)",
    "https://evil.example/other",
    "/s/join/short",
    `https://floor.example/s/join/${"a".repeat(22)}/extra`,
  ])("rejects invalid link %s", (input) =>
    expect(inviteCodeFromInput(input)).toBeNull(),
  );
  it("requires a valid name and offers all eight accessible colors", async () => {
    const user = userEvent.setup();
    const action = vi.fn(async () => ({
      ok: true as const,
      data: { spaceId, roomId },
    }));
    const onDone = vi.fn();
    mount(<CreateSpaceForm action={action} onDone={onDone} />);
    expect(screen.getByRole("button", { name: "만들기" })).toBeDisabled();
    expect(screen.getAllByRole("radio")).toHaveLength(8);
    await user.type(screen.getByLabelText("스페이스 이름"), "새 모임");
    await user.click(screen.getByRole("radio", { name: "초록" }));
    await user.click(screen.getByRole("button", { name: "만들기" }));
    await waitFor(() =>
      expect(action).toHaveBeenCalledWith({
        name: "새 모임",
        iconColor: "green",
      }),
    );
    expect(onDone).toHaveBeenCalledOnce();
    expect(mocks.push).toHaveBeenCalledWith(`/s/${spaceId}/${roomId}`);
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });
  it("prevents rapid duplicate submits and shows the safe limit reason", async () => {
    let resolve!: (value: {
      ok: false;
      code: "LIMIT_EXCEEDED";
      message: string;
    }) => void;
    const action = vi.fn(
      () =>
        new Promise<{ ok: false; code: "LIMIT_EXCEEDED"; message: string }>(
          (done) => {
            resolve = done;
          },
        ),
    );
    mount(<CreateSpaceForm action={action} onDone={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("스페이스 이름"), {
      target: { value: "모임" },
    });
    const form = screen.getByLabelText("스페이스 이름").closest("form")!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    resolve({ ok: false, code: "LIMIT_EXCEEDED", message: "space_count" });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "스페이스는 10개까지 만들 수 있어요",
    );
    expect(mocks.push).not.toHaveBeenCalled();
  });
  it("connects overlong name validation to its input", () => {
    mount(<CreateSpaceForm onDone={vi.fn()} />);
    const input = screen.getByLabelText("스페이스 이름");
    fireEvent.change(input, { target: { value: "가".repeat(31) } });
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert").id).toBe(
      input.getAttribute("aria-describedby"),
    );
  });
  it("opens both create and join choices from the plus menu", async () => {
    const user = userEvent.setup();
    mount(<SpaceAdd />);
    await user.click(screen.getByRole("button", { name: "스페이스 추가" }));
    expect(
      screen.getByRole("menuitem", { name: "스페이스 만들기" }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("menuitem", { name: "초대 링크로 참여" }),
    );
    const code = "b".repeat(22);
    await user.type(screen.getByLabelText("초대 링크 또는 코드"), code);
    await user.click(screen.getByRole("button", { name: "초대 확인하기" }));
    expect(mocks.push).toHaveBeenCalledWith(`/s/join/${code}`);
  });
  it("renders invalid/member/open invite states and only joins on explicit intent", async () => {
    const action = vi.fn(async () => ({
      ok: true as const,
      data: { spaceId },
    }));
    const user = userEvent.setup();
    const client = new QueryClient();
    const tree = (preview: Parameters<typeof SpaceJoin>[0]["preview"]) => (
      <QueryClientProvider client={client}>
        <SpaceJoin code={"a".repeat(22)} preview={preview} action={action} />
      </QueryClientProvider>
    );
    const view = render(tree({ state: "invalid" }));
    expect(
      screen.getByText("초대가 만료됐거나 올바르지 않아요"),
    ).toBeInTheDocument();
    view.rerender(tree({ state: "member", spaceId }));
    expect(screen.getByRole("link", { name: "열기" })).toHaveAttribute(
      "href",
      `/s/${spaceId}`,
    );
    view.rerender(
      tree({
        state: "open",
        spaceName: "커뮤니티",
        iconColor: "blue",
        memberCount: 3,
      }),
    );
    expect(action).not.toHaveBeenCalled();
    expect(screen.getByText("멤버 3명")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "참여" }));
    await waitFor(() =>
      expect(mocks.push).toHaveBeenCalledWith(`/s/${spaceId}`),
    );
  });
  it("renders initial select labels and a generated invite link", async () => {
    const user = userEvent.setup(),
      code = "a".repeat(22);
    const action = vi.fn(async () => ({
      ok: true as const,
      data: {
        inviteId: roomId,
        code,
        url: `https://floor.example/s/join/${code}`,
      },
    }));
    mount(<InviteLinkForm spaceId={spaceId} action={action} />);
    expect(screen.getByRole("combobox", { name: "만료" })).toHaveTextContent(
      "7일 뒤",
    );
    expect(
      screen.getByRole("combobox", { name: "사용 횟수" }),
    ).toHaveTextContent("10회");
    await user.click(screen.getByRole("button", { name: "링크 만들기" }));
    expect(await screen.findByLabelText("만든 초대 링크")).toHaveValue(
      `https://floor.example/s/join/${code}`,
    );
    expect(action).toHaveBeenCalledWith({
      spaceId,
      expiresIn: "7d",
      maxUses: 10,
    });
  });
  it.each([
    ["space_join_count", "스페이스에는 100개까지 들어갈 수 있어요"],
    ["space_full", "이 스페이스는 꽉 찼어요"],
    ["invite_count", "오늘은 초대를 더 만들 수 없어요"],
    ["channel_count", "채널은 50개까지 만들 수 있어요"],
  ])("maps %s safely", (message, text) =>
    expect(
      spaceActionMessage({ ok: false, code: "LIMIT_EXCEEDED", message }),
    ).toBe(text),
  );
  it("keeps a single invite dialog while candidates arrive, then sends selected people", async () => {
    const user = userEvent.setup();
    let resolve!: (
      value: { userId: string; name: string; username: string | null }[],
    ) => void;
    const candidates = new Promise<
      { userId: string; name: string; username: string | null }[]
    >((done) => {
      resolve = done;
    });
    mocks.invite.mockResolvedValue({ ok: true, data: { sent: 0 } });
    await act(async () => { mount(
      <SpaceInviteDialog
        spaceId={spaceId}
        spaceName="가상 모임"
        candidates={candidates}
        returnHref={`/s/${spaceId}/settings`}
      />,
    ); });
    const dialog = screen.getByRole("dialog");
    expect(
      screen.getByRole("status", { name: "초대할 사람을 불러오고 있어요" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "초대 보내기" }),
    ).not.toBeInTheDocument();
    await act(async () =>
      resolve([{ userId: roomId, name: "김하은", username: "haeun" }]),
    );
    expect(screen.getByRole("dialog")).toBe(dialog);
    await user.click(await screen.findByRole("checkbox", { name: /김하은/ }));
    await user.click(screen.getByRole("button", { name: "초대 보내기" }));
    await waitFor(() =>
      expect(mocks.invite).toHaveBeenCalledExactlyOnceWith({
        spaceId,
        userIds: [roomId],
      }),
    );
    expect(mocks.success).toHaveBeenCalledWith("새로 보낼 사람이 없어요");
  });
  it("selects the generated link when clipboard access fails", async () => {
    const user = userEvent.setup();
    const url = `https://floor.example/s/join/${"a".repeat(22)}`;
    const action = vi.fn(async () => ({
      ok: true as const,
      data: { inviteId: roomId, code: "a".repeat(22), url },
    }));
    mount(<InviteLinkForm spaceId={spaceId} action={action} />);
    await user.click(screen.getByRole("button", { name: "링크 만들기" }));
    const input = await screen.findByRole<HTMLInputElement>("textbox", {
      name: "만든 초대 링크",
    });
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(
      new Error("denied"),
    );
    await user.click(screen.getByRole("button", { name: "복사" }));
    expect(input).toHaveFocus();
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, url.length]);
  });
  it("keeps community owners from leaving and exposes the invite route", async () => {
    const user = userEvent.setup();
    mount(
      <SpaceMenu
        space={{
          id: spaceId,
          kind: "community",
          name: "모임",
          role: "owner",
          muted: false,
        }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "모임" }));
    expect(screen.getByRole("menuitem", { name: "소유권을 넘겨야 나갈 수 있어요" })).toHaveAttribute(
      "data-disabled",
    );
    expect(screen.getByRole("menuitem", { name: "사람 초대" })).toHaveAttribute(
      "href",
      `/s/${spaceId}/settings?invite=1`,
    );
    expect(mocks.leave).not.toHaveBeenCalled();
  });
});
