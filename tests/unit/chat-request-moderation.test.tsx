import { Activity, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MessageRequestDialog,
  type SendMessageRequest,
} from "@/features/chat/components/message-request-dialog";
import {
  MessageRequestBanner,
  type RespondMessageRequest,
} from "@/features/chat/components/message-request-banner";
import {
  BlockUserDialog,
  ReportDialog,
  type ModerationAction,
} from "@/features/people/components/moderation-dialogs";
import type { ActionResult } from "@/lib/actions/result";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  success: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks }));
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));
const person = { userId: "other", name: "박지훈", canDirectMessage: false };
function setup(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const result = render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
  return { ...result, client, user: userEvent.setup() };
}
function success() {
  return { ok: true as const, data: {} };
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
afterEach(() => vi.unstubAllGlobals());

describe("message request dialog", () => {
  it("is absent for someone who can receive a direct message", () => {
    const send = vi.fn();
    setup(
      <MessageRequestDialog
        person={{ ...person, canDirectMessage: true }}
        open
        onOpenChange={vi.fn()}
        send={send}
      />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();
  });
  it("preserves composition and Shift+Enter, prevents double sends, and navigates only after confirmation", async () => {
    let resolve!: (value: ActionResult<{ roomId: string }>) => void;
    const send = vi.fn<SendMessageRequest>(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const close = vi.fn();
    const { user } = setup(
      <MessageRequestDialog
        person={person}
        open
        onOpenChange={close}
        send={send}
      />,
    );
    expect(
      screen.getByText(/친구가 아니어서 메시지 요청으로 가요/),
    ).toBeVisible();
    const input = screen.getByLabelText("메시지");
    await user.type(input, "안녕하세요");
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(send).not.toHaveBeenCalled();
    await user.keyboard("{Shift>}{Enter}{/Shift}");
    expect(send).not.toHaveBeenCalled();
    await user.dblClick(screen.getByRole("button", { name: "보내기" }));
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({
      userId: "other",
      clientId: expect.any(String),
      body: "안녕하세요",
    });
    expect(mocks.push).not.toHaveBeenCalled();
    await act(async () => resolve({ ok: true, data: { roomId: "room" } }));
    expect(close).toHaveBeenCalledWith(false);
    expect(mocks.push).toHaveBeenCalledExactlyOnceWith("/dm/room");
  });
  it("validates the Unicode 4000-character boundary and connects feedback", async () => {
    const send = vi.fn();
    const { user } = setup(
      <MessageRequestDialog
        person={person}
        open
        onOpenChange={vi.fn()}
        send={send}
      />,
    );
    const input = screen.getByLabelText("메시지");
    expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "😀".repeat(4000) } });
    expect(screen.getByRole("button", { name: "보내기" })).toBeEnabled();
    fireEvent.change(input, { target: { value: "😀".repeat(4001) } });
    await user.keyboard("{Enter}");
    expect(send).not.toHaveBeenCalled();
    expect(input).toHaveAttribute("aria-invalid", "true");
  });
  it.each([
    [
      { ok: false, code: "LIMIT_EXCEEDED", message: "request_daily" },
      "오늘은 메시지 요청을 더 보낼 수 없어요",
    ],
    [
      { ok: false, code: "LIMIT_EXCEEDED", message: "request_pending" },
      "상대가 수락하면 더 보낼 수 있어요",
    ],
    [{ ok: false, code: "FORBIDDEN" }, "메시지를 보낼 수 없어요"],
  ] as const)(
    "keeps the draft after a safe error: %j",
    async (result, text) => {
      const send = vi.fn<SendMessageRequest>(async () => result);
      const { user } = setup(
        <MessageRequestDialog
          person={person}
          open
          onOpenChange={vi.fn()}
          send={send}
        />,
      );
      await user.type(screen.getByLabelText("메시지"), "안녕하세요");
      await user.click(screen.getByRole("button", { name: "보내기" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(text);
      expect(screen.getByLabelText("메시지")).toHaveValue("안녕하세요");
      await user.click(screen.getByRole("button", { name: "보내기" }));
      expect(send.mock.calls[0]?.[0]).toEqual(send.mock.calls[1]?.[0]);
    },
  );
  it("ignores a response after Activity hide or a new recipient", async () => {
    let resolve!: (value: ActionResult<{ roomId: string }>) => void;
    const send = vi.fn<SendMessageRequest>(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const client = new QueryClient();
    const close = vi.fn();
    const ui = (mode: "hidden" | "visible", userId = "other") => (
      <QueryClientProvider client={client}>
        <Activity mode={mode}>
          <MessageRequestDialog
            person={{ ...person, userId }}
            open
            onOpenChange={close}
            send={send}
          />
        </Activity>
      </QueryClientProvider>
    );
    const { rerender } = render(ui("visible"));
    fireEvent.change(screen.getByLabelText("메시지"), {
      target: { value: "내용" },
    });
    fireEvent.click(screen.getByRole("button", { name: "보내기" }));
    await waitFor(() => expect(send).toHaveBeenCalledOnce());
    rerender(ui("hidden"));
    rerender(ui("visible", "new"));
    await act(async () => resolve({ ok: true, data: { roomId: "old-room" } }));
    expect(mocks.push).not.toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
});

describe("message request banners", () => {
  it.each([true, false])(
    "lets the recipient respond once and routes appropriately (accept %s)",
    async (accept) => {
      const respond = vi.fn<RespondMessageRequest>(async () => success());
      const { user } = setup(
        <MessageRequestBanner
          roomId="room"
          other={person}
          request={{ role: "recipient" }}
          respond={respond}
          block={vi.fn()}
        />,
      );
      expect(
        screen.getByText("박지훈 님이 메시지를 보내고 싶어 해요"),
      ).toBeVisible();
      await user.click(
        screen.getByRole("button", { name: accept ? "수락" : "거절" }),
      );
      expect(respond).toHaveBeenCalledExactlyOnceWith({
        roomId: "room",
        accept,
      });
      if (accept) expect(mocks.refresh).toHaveBeenCalledOnce();
      else expect(mocks.push).toHaveBeenCalledWith("/friends?tab=requests");
    },
  );
  it("gives the sender no indication of whether an unanswered request was declined", () => {
    setup(
      <MessageRequestBanner
        roomId="room"
        other={person}
        request={{ role: "sender", sentCount: 3 }}
        respond={vi.fn()}
        block={vi.fn()}
      />,
    );
    expect(
      screen.getByText("박지훈 님이 수락하면 대화가 시작돼요"),
    ).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
  it("clears its banner when refreshed request data is accepted", () => {
    const props = {
      roomId: "room",
      other: person,
      respond: vi.fn(),
      block: vi.fn(),
    };
    const client = new QueryClient();
    const { rerender } = render(
      <QueryClientProvider client={client}>
        <MessageRequestBanner {...props} request={{ role: "recipient" }} />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={client}>
        <MessageRequestBanner {...props} request={null} />
      </QueryClientProvider>,
    );
    expect(
      screen.queryByRole("region", { name: "메시지 요청" }),
    ).not.toBeInTheDocument();
  });
});

describe("moderation confirmation and reports", () => {
  it("confirms block, refreshes local metadata, and uses only a generic failure", async () => {
    const action = vi
      .fn<ModerationAction>()
      .mockResolvedValueOnce({ ok: false, code: "NOT_FOUND" })
      .mockResolvedValueOnce(success());
    const close = vi.fn();
    const { user, client } = setup(
      <BlockUserDialog
        person={person}
        open
        onOpenChange={close}
        action={action}
      />,
    );
    const invalidate = vi.spyOn(client, "invalidateQueries");
    expect(screen.getByText(/상대에게는 알리지 않아요/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "차단" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "차단하지 못했어요",
    );
    await user.click(screen.getByRole("button", { name: "차단" }));
    expect(action).toHaveBeenCalledWith({ userId: "other" });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chat", "nav"] });
    expect(close).toHaveBeenCalledWith(false);
  });
  it("requires a reason and limits the optional description to 500 codepoints", async () => {
    const report = vi.fn();
    const { user } = setup(
      <ReportDialog
        target={person}
        open
        onOpenChange={vi.fn()}
        report={report}
        block={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "신고" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "신고 사유를 골라 주세요",
    );
    await user.click(screen.getByRole("radio", { name: "스팸" }));
    fireEvent.change(screen.getByLabelText("설명 (선택)"), {
      target: { value: "한".repeat(501) },
    });
    await user.click(screen.getByRole("button", { name: "신고" }));
    expect(report).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("설명은 500자까지");
  });
  it("reports the message first and optionally blocks without submitting the report twice on partial failure", async () => {
    const report = vi.fn<ModerationAction>(async () => success());
    const block = vi
      .fn<ModerationAction>()
      .mockResolvedValueOnce({ ok: false, code: "INTERNAL" })
      .mockResolvedValueOnce(success());
    const close = vi.fn();
    const { user } = setup(
      <ReportDialog
        target={{ ...person, messageId: "message" }}
        open
        onOpenChange={close}
        report={report}
        block={block}
      />,
    );
    await user.click(screen.getByRole("radio", { name: "괴롭힘" }));
    await user.type(screen.getByLabelText("설명 (선택)"), "  설명  ");
    await user.click(
      screen.getByRole("checkbox", { name: "이 사람도 차단하기" }),
    );
    await user.click(screen.getByRole("button", { name: "신고" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "신고는 완료했지만 차단하지 못했어요",
    );
    expect(report).toHaveBeenCalledExactlyOnceWith({
      messageId: "message",
      reason: "harassment",
      detail: "설명",
    });
    expect(report.mock.invocationCallOrder[0]).toBeLessThan(
      block.mock.invocationCallOrder[0]!,
    );
    expect(close).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "차단 다시 시도" }));
    expect(report).toHaveBeenCalledOnce();
    expect(block).toHaveBeenCalledTimes(2);
    expect(close).toHaveBeenCalledWith(false);
    expect(mocks.success).toHaveBeenCalledExactlyOnceWith(
      "신고했어요. 검토에 쓸게요",
    );
  });
  it("handles the report limit without blocking or exposing an internal error", async () => {
    const report = vi.fn<ModerationAction>(async () => ({
      ok: false,
      code: "LIMIT_EXCEEDED",
      message: "report_daily",
    }));
    const block = vi.fn();
    const { user } = setup(
      <ReportDialog
        target={person}
        open
        onOpenChange={vi.fn()}
        report={report}
        block={block}
      />,
    );
    await user.click(screen.getByRole("radio", { name: "기타" }));
    await user.click(
      screen.getByRole("checkbox", { name: "이 사람도 차단하기" }),
    );
    await user.click(screen.getByRole("button", { name: "신고" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "오늘은 신고를 더 할 수 없어요",
    );
    expect(block).not.toHaveBeenCalled();
  });
  it("supports closing the report dialog with keyboard and explicit focus restoration", async () => {
    function Example() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)} id="report-trigger">
            신고 열기
          </button>
          <ReportDialog
            target={person}
            open={open}
            onOpenChange={setOpen}
            report={vi.fn()}
            block={vi.fn()}
            onReturnFocus={() =>
              document.getElementById("report-trigger")?.focus()
            }
          />
        </>
      );
    }
    const { user } = setup(<Example />);
    await user.tab();
    await user.keyboard("{Enter}");
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "신고 열기" })).toHaveFocus(),
    );
  });
});
