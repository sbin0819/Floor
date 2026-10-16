import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Activity } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { makeQueryClient } from "@/app/providers";
import { SESSION_EXPIRED_MESSAGE } from "@/lib/errors/messages";
import { ApiError } from "@/lib/http/errors";
import { HomeChecklist } from "@/features/home/components/home-checklist";
import { HomeTodo } from "@/features/home/components/home-todo";
import { HomeRecentChats } from "@/features/home/components/home-recent-chats";
import { dismissHomeChecklist } from "@/features/home/actions";
import { homeChecklist, homeChats, homeTodo } from "../helpers/home";

const refresh = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/features/home/actions", () => ({ dismissHomeChecklist: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/");
});

it("omits zero-count todo items and the entire empty row", () => {
  const view = render(<HomeTodo data={homeTodo} />);
  expect(
    screen.queryByRole("region", { name: "확인할 것" }),
  ).not.toBeInTheDocument();
  view.rerender(<HomeTodo data={{ ...homeTodo, friendRequests: 2 }} />);
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(
    screen.getByRole("link", { name: "받은 친구 요청 2개" }),
  ).toHaveAttribute("href", "/friends?tab=received");
});

it("links every todo count to its exact destination in a mobile-first list", () => {
  render(
    <HomeTodo
      data={{
        joinRequests: {
          top: { teamId: "team", teamName: "가상 팀", count: 4 },
          rest: 2,
        },
        teamInvites: 3,
        friendRequests: 1,
        messageRequests: 5,
        spaceInvites: { count: 2, href: "/s/join/code" },
      }}
    />,
  );
  for (const [name, href] of [
    ["가상 팀 가입 요청 4개", "/teams/team?tab=requests"],
    ["가입 요청 2개", "/teams"],
    ["받은 팀 초대 3개", "/teams"],
    ["받은 친구 요청 1개", "/friends?tab=received"],
    ["메시지 요청 5개", "/friends?tab=requests"],
    ["스페이스 초대 2개", "/s/join/code"],
  ]) {
    const link = screen.getByRole("link", { name });
    expect(link).toHaveAttribute("href", href);
    expect(link).toHaveClass("min-h-11");
  }
  expect(screen.getByRole("list")).toHaveClass("flex-col", "lg:flex-row");
});

it("renders server-approved chat excerpts as text, group identity and unread count or mention", () => {
  const { container } = render(
    <HomeRecentChats
      data={homeChats.map((row, i) =>
        i === 0 ? { ...row, excerpt: "<b>사진</b> **본문** @이서연" } : row,
      )}
    />,
  );
  expect(screen.getByText("<b>사진</b> **본문** @이서연")).toBeVisible();
  expect(container.querySelector("b")).toBeNull();
  expect(screen.getByText("그룹 · 3명")).toBeVisible();
  expect(screen.getByText("# 일반 · 디자인 스튜디오")).toBeVisible();
  expect(screen.getByLabelText("읽지 않은 메시지 2개")).toHaveTextContent("2");
  expect(screen.getByLabelText("읽지 않은 멘션")).toHaveTextContent("@");
  expect(screen.getByRole("link", { name: /메시지$/ })).toHaveAttribute(
    "href",
    "/messages",
  );
  const links = within(screen.getByRole("list")).getAllByRole("link");
  expect(links.map((link) => link.getAttribute("href"))).toEqual(
    homeChats.map((row) => row.href),
  );
  expect(container.querySelectorAll("[data-user-avatar]")).toHaveLength(2);
});
it("does not fabricate a recent-chat empty card", () => {
  render(<HomeRecentChats data={[]} />);
  expect(screen.queryByRole("region")).not.toBeInTheDocument();
});

function checklist(data = homeChecklist, client = new QueryClient()) {
  return render(
    <QueryClientProvider client={client}>
      <HomeChecklist data={data} />
    </QueryClientProvider>,
  );
}
it("announces completed steps and emphasizes only the first incomplete step", () => {
  checklist();
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "1");
  expect(screen.getByText("가입하고 이메일 인증")).toHaveClass("line-through");
  expect(screen.getByRole("link", { name: "정하기" })).toHaveAttribute(
    "data-variant",
    "default",
  );
  for (const [name, href] of [
    ["팀 찾기", "/teams/start"],
    ["예약하기", "/booking"],
    ["친구 찾기", "/friends"],
  ]) {
    expect(screen.getByRole("link", { name })).toHaveAttribute(
      "data-variant",
      "outline",
    );
    expect(screen.getByRole("link", { name })).toHaveAttribute("href", href);
  }
});
it("shows four completed steps and leaves only the friend action primary", () => {
  checklist({
    ...homeChecklist,
    steps: {
      ...homeChecklist.steps,
      username: true,
      team: true,
      booking: true,
    },
  });
  expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "4");
  expect(screen.getAllByRole("link")).toHaveLength(1);
  expect(screen.getByRole("link", { name: "친구 찾기" })).toHaveAttribute(
    "data-variant",
    "default",
  );
});
it("hides immediately, submits only once with one argument, and refreshes after success", async () => {
  let finish!: (
    result: Awaited<ReturnType<typeof dismissHomeChecklist>>,
  ) => void;
  vi.mocked(dismissHomeChecklist).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  checklist();
  const button = screen.getByRole("button", { name: "시작 안내 닫기" });
  fireEvent.click(button);
  fireEvent.click(button);
  expect(
    screen.queryByRole("region", { name: "Floor 시작하기" }),
  ).not.toBeInTheDocument();
  await act(async () => {});
  expect(dismissHomeChecklist).toHaveBeenCalledExactlyOnceWith({});
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => finish({ ok: true, data: {} }));
  expect(refresh).toHaveBeenCalledOnce();
});
it.each([false, true])(
  "restores a hidden checklist with a safe toast after failure (throws=%s)",
  async (throws) => {
    if (throws)
      vi.mocked(dismissHomeChecklist).mockRejectedValue(
        new Error("private server data"),
      );
    else
      vi.mocked(dismissHomeChecklist).mockResolvedValue({
        ok: false,
        code: "INTERNAL",
      });
    checklist();
    await userEvent.click(
      screen.getByRole("button", { name: "시작 안내 닫기" }),
    );
    expect(
      await screen.findByRole("region", { name: "Floor 시작하기" }),
    ).toBeVisible();
    expect(toast.error).toHaveBeenCalledWith(
      "시작 안내를 닫지 못했어요. 잠시 뒤 다시 시도해 주세요",
    );
    expect(refresh).not.toHaveBeenCalled();
  },
);
it.each([false, true])(
  "restores the checklist with one shared login notice after auth failure (throws=%s)",
  async (throws) => {
    if (throws)
      vi.mocked(dismissHomeChecklist).mockRejectedValue(
        new ApiError("http", { status: 401 }),
      );
    else
      vi.mocked(dismissHomeChecklist).mockResolvedValue({
        ok: false,
        code: "UNAUTHENTICATED",
      });
    checklist(homeChecklist, makeQueryClient());
    for (let attempt = 0; attempt < 2; attempt++) {
      const button = await screen.findByRole("button", {
        name: "시작 안내 닫기",
      });
      await waitFor(() => expect(button).toBeEnabled());
      await userEvent.click(button);
      expect(
        await screen.findByRole("region", { name: "Floor 시작하기" }),
      ).toBeVisible();
    }
    expect(toast.error).toHaveBeenCalledExactlyOnceWith(
      SESSION_EXPIRED_MESSAGE,
      expect.objectContaining({
        action: { label: "로그인하기", onClick: expect.any(Function) },
      }),
    );
    expect(dismissHomeChecklist).toHaveBeenCalledTimes(2);
    expect(refresh).not.toHaveBeenCalled();
  },
);
it("restores the optimistic checklist silently after cancellation", async () => {
  vi.mocked(dismissHomeChecklist).mockRejectedValue(
    new DOMException("Aborted", "AbortError"),
  );
  checklist(homeChecklist, makeQueryClient());
  await userEvent.click(screen.getByRole("button", { name: "시작 안내 닫기" }));
  expect(
    await screen.findByRole("region", { name: "Floor 시작하기" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "시작 안내 닫기" })).toBeEnabled();
  expect(toast.error).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
});
it("does not refresh another route after a late successful dismissal", async () => {
  let finish!: (
    result: Awaited<ReturnType<typeof dismissHomeChecklist>>,
  ) => void;
  vi.mocked(dismissHomeChecklist).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = checklist();
  await userEvent.click(screen.getByRole("button", { name: "시작 안내 닫기" }));
  window.history.replaceState(null, "", "/friends");
  view.unmount();
  await act(async () => finish({ ok: true, data: {} }));
  expect(refresh).not.toHaveBeenCalled();
});

it.each([false, true])(
  "restores one deferred failure after Activity resumes (throws=%s)",
  async (throws) => {
    let finish!: (
      result: Awaited<ReturnType<typeof dismissHomeChecklist>>,
    ) => void;
    let fail!: (reason: Error) => void;
    vi.mocked(dismissHomeChecklist).mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          finish = resolve;
          fail = reject;
        }),
    );
    const client = new QueryClient();
    const ui = (mode: "visible" | "hidden") => (
      <QueryClientProvider client={client}>
        <Activity mode={mode}>
          <HomeChecklist data={homeChecklist} />
        </Activity>
      </QueryClientProvider>
    );
    const view = render(ui("visible"));
    await userEvent.click(
      screen.getByRole("button", { name: "시작 안내 닫기" }),
    );
    view.rerender(ui("hidden"));
    await act(async () => {
      if (throws) fail(new Error("private"));
      else finish({ ok: false, code: "INTERNAL" });
    });
    expect(toast.error).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    view.rerender(ui("visible"));
    expect(
      await screen.findByRole("region", { name: "Floor 시작하기" }),
    ).toBeVisible();
    expect(toast.error).toHaveBeenCalledOnce();
    view.rerender(ui("hidden"));
    view.rerender(ui("visible"));
    await act(async () => {});
    expect(toast.error).toHaveBeenCalledOnce();
  },
);
