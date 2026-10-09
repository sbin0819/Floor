import { Activity, useContext, useMemo, type ReactNode } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { AnnouncementForm } from "@/features/admin/components/announcement-form";
import {
  AnnouncementColumns,
  AnnouncementFrame,
  AnnouncementHistory,
  AnnouncementSkeleton,
} from "@/features/admin/components/announcement-frame";
import {
  AnnouncementPreview,
  AnnouncementPreviewContext,
} from "@/features/admin/components/announcement-preview";
import { sendAnnouncement } from "@/features/admin/announcement-actions";
import {
  announcementPath,
  announcementPreviewRequest,
} from "@/features/admin/announcement-navigation";
import {
  announcementBranchId,
  announcementPreviewFixture,
  announcementRequest,
  announcementsFixture,
} from "@/tests/helpers/announcements";

const navigation = vi.hoisted(() => ({ replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/features/admin/announcement-actions", () => ({
  sendAnnouncement: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", announcementPath(announcementBranchId));
  navigation.replace.mockImplementation((url: string) =>
    window.history.replaceState({}, "", url),
  );
  vi.mocked(sendAnnouncement).mockResolvedValue({
    ok: true,
    data: {
      announcementId: "60000000-0000-4000-8000-000000000001",
      recipientCount: 23,
    },
  });
});
afterEach(() => vi.useRealTimers());
function AutoPreview({ count = 23 }: { count?: number }) {
  const context = useContext(AnnouncementPreviewContext);
  const result = useMemo(
    () => ({ ok: true as const, data: announcementPreviewFixture(count) }),
    [count],
  );
  return context?.key ? (
    <AnnouncementPreview requestKey={context.key} result={result} />
  ) : null;
}
function provide(
  child: ReactNode,
  client = new QueryClient({ defaultOptions: { mutations: { retry: false } } }),
) {
  return <QueryClientProvider client={client}>{child}</QueryClientProvider>;
}
function fill() {
  fireEvent.change(screen.getByLabelText("제목"), {
    target: { value: "7층 전기 점검 안내" },
  });
  fireEvent.change(screen.getByLabelText("내용"), {
    target: { value: "오전 8시까지 점검해요. https://example.com" },
  });
}
describe("announcement compose", () => {
  it("prerenders fixed headings and labels without inventing empty history", () => {
    render(
      <AnnouncementFrame>
        <AnnouncementSkeleton />
      </AnnouncementFrame>,
    );
    expect(screen.getByRole("heading", { name: "공지" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "공지 보내기" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "보낸 공지" })).toBeVisible();
    expect(screen.getByText("제목")).toBeVisible();
    expect(screen.queryByText(/보낸 공지가 없어요/)).not.toBeInTheDocument();
  });
  it.each([
    [true, true, "보내기 · 라운지와 23명"],
    [true, false, "보내기 · 라운지"],
    [false, true, "보내기 · 23명"],
  ] as const)(
    "labels destinations %s/%s and submits the same destination",
    async (lounge, audience, label) => {
      const user = userEvent.setup();
      render(
        provide(
          <AnnouncementForm
            data={announcementsFixture()}
            initialRequest={announcementRequest(lounge, audience)}
          >
            <AutoPreview />
          </AnnouncementForm>,
        ),
      );
      fill();
      await user.click(await screen.findByRole("button", { name: label }));
      await waitFor(() => expect(sendAnnouncement).toHaveBeenCalledOnce());
      expect(sendAnnouncement).toHaveBeenCalledWith(
        expect.objectContaining({
          lounge,
          audience: audience ? announcementRequest().input.audience : null,
          title: "7층 전기 점검 안내",
        }),
      );
      expect(toast.success).toHaveBeenCalledWith("공지를 보냈어요");
      expect(screen.getByLabelText("제목")).toHaveValue("");
      expect(screen.getByLabelText("내용")).toHaveValue("");
      expect(navigation.refresh).toHaveBeenCalledOnce();
    },
  );
  it("keeps the count unknown and submit disabled until the matching server reply", () => {
    render(
      provide(
        <AnnouncementForm
          data={announcementsFixture()}
          initialRequest={announcementRequest()}
        />,
      ),
    );
    fill();
    expect(screen.getByText("받는 사람 수를 확인하고 있어요")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "받는 사람 확인 중" }),
    ).toBeDisabled();
    expect(screen.queryByText(/참석자 0명/)).not.toBeInTheDocument();
  });
  it("debounces destinations, excludes text from URL and ignores old replies", async () => {
    vi.useFakeTimers();
    const request = announcementRequest();
    const view = render(
      provide(
        <AnnouncementForm
          data={announcementsFixture()}
          initialRequest={request}
        >
          <AnnouncementPreview
            requestKey={`${request.inputKey}:${request.nonce}`}
            result={{ ok: true, data: announcementPreviewFixture() }}
          />
        </AnnouncementForm>,
      ),
    );
    fill();
    fireEvent.change(screen.getByLabelText("날짜"), {
      target: { value: "2026-10-15" },
    });
    fireEvent.change(screen.getByLabelText("날짜"), {
      target: { value: "2026-10-16" },
    });
    await act(() => vi.advanceTimersByTimeAsync(299));
    expect(navigation.replace).not.toHaveBeenCalled();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(navigation.replace).toHaveBeenCalledOnce();
    const url = new URL(
      navigation.replace.mock.calls[0]![0],
      window.location.origin,
    );
    expect(url.searchParams.get("date")).toBe("2026-10-16");
    expect(url.href).not.toContain("전기");
    expect(
      screen.getByRole("button", { name: "받는 사람 확인 중" }),
    ).toBeDisabled();
    const next = announcementPreviewRequest(
      announcementBranchId,
      Object.fromEntries(url.searchParams),
    )!;
    view.rerender(
      provide(
        <AnnouncementForm data={announcementsFixture()} initialRequest={next}>
          <AnnouncementPreview
            requestKey={`${request.inputKey}:${request.nonce}`}
            result={{ ok: true, data: announcementPreviewFixture(99) }}
          />
        </AnnouncementForm>,
      ),
    );
    expect(screen.queryByText(/참석자 99명/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("제목")).toHaveValue("7층 전기 점검 안내");
  });
  it("validates empty/too-long text, counts Unicode characters and rejects explicit mention syntax", async () => {
    const user = userEvent.setup();
    render(
      provide(
        <AnnouncementForm
          data={announcementsFixture()}
          initialRequest={announcementRequest(true, false)}
        />,
      ),
    );
    await user.click(screen.getByRole("button", { name: "보내기 · 라운지" }));
    expect(screen.getByLabelText("제목")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(sendAnnouncement).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("제목"), {
      target: { value: "😀".repeat(61) },
    });
    fireEvent.change(screen.getByLabelText("내용"), {
      target: { value: "<@everyone>" },
    });
    await user.click(screen.getByRole("button", { name: "보내기 · 라운지" }));
    expect(screen.getByLabelText("내용")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(sendAnnouncement).not.toHaveBeenCalled();
  });
  it.each(["missing_channel", "banned", "space_limit"] as const)(
    "disables unavailable lounge %s",
    (reason) => {
      render(
        provide(
          <AnnouncementForm
            data={announcementsFixture({
              lounge: { available: false, reason, memberCount: 0 },
            })}
          />,
        ),
      );
      expect(
        screen.getByRole("checkbox", { name: "강남점 라운지 # 공지" }),
      ).toBeDisabled();
      expect(screen.getByRole("button", { name: "보내기" })).toBeDisabled();
    },
  );
  it("does not send audience-only zero or too many recipients", () => {
    const view = render(
      provide(
        <AnnouncementForm
          data={announcementsFixture()}
          initialRequest={announcementRequest(false, true)}
        >
          <AutoPreview count={0} />
        </AnnouncementForm>,
      ),
    );
    expect(screen.getByRole("button", { name: "보내기 · 0명" })).toBeDisabled();
    view.rerender(
      provide(
        <AnnouncementForm
          data={announcementsFixture()}
          initialRequest={announcementRequest(false, true)}
        >
          <AutoPreview count={501} />
        </AnnouncementForm>,
      ),
    );
    expect(
      screen.getByRole("button", { name: "보내기 · 501명" }),
    ).toBeDisabled();
  });
  it("previews a safe lounge bubble and expandable notification text without sending", async () => {
    const user = userEvent.setup();
    render(
      provide(
        <AnnouncementForm
          data={announcementsFixture()}
          initialRequest={announcementRequest()}
        >
          <AutoPreview />
        </AnnouncementForm>,
      ),
    );
    fill();
    await user.click(screen.getByRole("button", { name: "미리보기" }));
    expect(screen.getByRole("dialog", { name: "공지 미리보기" })).toBeVisible();
    expect(screen.getByText("@모두")).toBeVisible();
    expect(
      screen.getByRole("link", { name: "https://example.com" }),
    ).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(sendAnnouncement).not.toHaveBeenCalled();
  });
  it("blocks duplicate submissions and keeps drafts on safe server failures", async () => {
    let finish!: (value: Awaited<ReturnType<typeof sendAnnouncement>>) => void;
    vi.mocked(sendAnnouncement).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    render(
      provide(
        <AnnouncementForm
          data={announcementsFixture()}
          initialRequest={announcementRequest(true, false)}
        />,
      ),
    );
    fill();
    const button = screen.getByRole("button", { name: "보내기 · 라운지" });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(sendAnnouncement).toHaveBeenCalledOnce());
    await act(async () =>
      finish({ ok: false, code: "LIMIT_EXCEEDED", message: "announce_daily" }),
    );
    expect(screen.getByText(/하루에 공지를 20개/)).toBeVisible();
    expect(screen.getByLabelText("제목")).toHaveValue("7층 전기 점검 안내");
  });
  it("does not navigate or clear a preserved form for a late success after leaving", async () => {
    let finish!: (value: Awaited<ReturnType<typeof sendAnnouncement>>) => void;
    vi.mocked(sendAnnouncement).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const client = new QueryClient();
    const form = (
      <AnnouncementForm
        data={announcementsFixture()}
        initialRequest={announcementRequest(true, false)}
      />
    );
    const view = render(
      provide(<Activity mode="visible">{form}</Activity>, client),
    );
    fill();
    fireEvent.click(screen.getByRole("button", { name: "보내기 · 라운지" }));
    await waitFor(() => expect(sendAnnouncement).toHaveBeenCalledOnce());
    view.rerender(provide(<Activity mode="hidden">{form}</Activity>, client));
    window.history.replaceState({}, "", "/admin");
    await act(async () =>
      finish({ ok: true, data: { announcementId: "id", recipientCount: 0 } }),
    );
    expect(navigation.refresh).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
    window.history.replaceState({}, "", announcementPath(announcementBranchId));
    view.rerender(provide(<Activity mode="visible">{form}</Activity>, client));
    expect(screen.getByLabelText("제목")).toHaveValue("7층 전기 점검 안내");
  });
  it("renders recent history with destination counts in the branch timezone", () => {
    render(
      <AnnouncementColumns
        form={null}
        history={<AnnouncementHistory data={announcementsFixture()} />}
      />,
    );
    expect(screen.getByText("7층 회의실 모니터 교체 안내")).toBeVisible();
    expect(screen.getByText(/라운지 #공지 · 알림 18명/)).toBeVisible();
    expect(screen.getByText(/10월 13일 09:12/)).toBeVisible();
  });
});
