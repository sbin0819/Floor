import { useState, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
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
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import {
  AdminBookings,
  AdminBookingsSkeleton,
} from "@/features/admin/components/admin-bookings";
import { OperatorCancelDialog } from "@/features/admin/components/operator-cancel-dialog";
import { cancelBookingAsOperator } from "@/features/admin/booking-actions";
import { cancellationPresets } from "@/features/admin/booking-schema";
import { adminBookingsHref } from "@/features/admin/booking-presentation";
import type { AdminBookingRow } from "@/features/admin/booking-types";
import type { ActionResult } from "@/lib/actions/result";
import {
  adminBookingFixture,
  adminBookingsFixture,
  adminBookingFloorId,
} from "@/tests/helpers/admin-bookings";

const navigation = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/features/admin/booking-actions", () => ({
  cancelBookingAsOperator: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeAll(() => {
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  Element.prototype.scrollIntoView = vi.fn();
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cancelBookingAsOperator).mockResolvedValue({
    ok: true,
    data: { bookingId: adminBookingFixture().id },
  });
});
function provider(children: ReactNode) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { mutations: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  );
}
function DialogFixture({
  row = adminBookingFixture(),
}: {
  row?: AdminBookingRow;
}) {
  const [open, setOpen] = useState(true);
  return (
    <OperatorCancelDialog
      row={row}
      timezone="Asia/Seoul"
      open={open}
      onOpenChange={setOpen}
    />
  );
}
async function selectPreset(preset = "운영 사정") {
  await userEvent.click(screen.getByRole("combobox", { name: "취소 이유" }));
  await userEvent.click(screen.getByRole("option", { name: preset }));
}
function submitDialog() {
  fireEvent.submit(
    screen.getByRole("button", { name: "예약 취소" }).closest("form")!,
  );
}

describe("admin booking read-only list", () => {
  it("shows real fixed headings before data without inventing zero or an empty state", () => {
    render(<AdminBookingsSkeleton />);
    expect(screen.getByRole("heading", { name: "예약 현황" })).toBeVisible();
    expect(
      screen.getByRole("heading", { name: "예약 현황" }).closest("header"),
    ).toHaveClass(
      "sticky",
      "top-[var(--admin-mobile-header-height,0px)]",
      "z-30",
      "bg-background",
    );
    expect(
      screen.getByText("지점의 예약을 살펴보고 취소할 수 있어요"),
    ).toBeVisible();
    expect(
      screen.getAllByRole("columnheader").map((cell) => cell.textContent),
    ).toEqual([
      "시간",
      "공간 · 층",
      "예약한 사람",
      "제목",
      "인원",
      "상태",
      "동작",
    ]);
    expect(
      screen.queryByText(/0건|조건에 맞는 예약이 없어요|박지훈/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /예약 동작/ }),
    ).not.toBeInTheDocument();
  });
  it("renders identical safe details in the desktop table and mobile cards without meeting links", () => {
    const row = {
      ...adminBookingFixture(),
      email: "hidden@example.test",
      meetingRoomId: "private-room",
      participantNames: ["비공개 참석자"],
    };
    render(
      provider(<AdminBookings data={adminBookingsFixture({ rows: [row] })} />),
    );
    const table = screen.getByRole("table");
    const cards = screen.getByRole("list");
    expect(table.closest(".lg\\:block")).toHaveClass("hidden");
    expect(cards).toHaveClass("lg:hidden");
    for (const surface of [table, cards]) {
      expect(surface).toHaveTextContent("12:00–13:00");
      expect(surface).toHaveTextContent("박지훈");
      expect(surface).toHaveTextContent("디자인팀 이름으로");
      expect(surface).toHaveTextContent("제품 기획 회의");
      expect(surface).toHaveTextContent("4명");
      expect(surface).toHaveTextContent("7F");
      expect(
        within(surface).getByRole("button", { name: "회의실 C 예약 동작" }),
      ).toHaveClass("size-11");
    }
    expect(document.body).not.toHaveTextContent(
      /hidden@example.test|비공개 참석자|private-room/,
    );
    expect(
      screen.queryByRole("link", { name: /채팅|회의 채널|회의실/ }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('a[href*="/m/"]')).toBeNull();
  });
  it("shows desk part, parent area and fallback participant count in both layouts", () => {
    render(
      provider(
        <AdminBookings
          data={adminBookingsFixture({
            rows: [
              adminBookingFixture({
                spaceType: "desk",
                spaceName: "A-12",
                areaName: "오픈 데스크",
                deskPart: "pm",
                attendeeCount: null,
                participantCount: 2,
                start: "2026-10-14T04:00:00Z",
                end: "2026-10-14T13:00:00Z",
              }),
            ],
          })}
        />,
      ),
    );
    for (const surface of [
      screen.getByRole("table"),
      screen.getByRole("list"),
    ]) {
      expect(surface).toHaveTextContent("좌석 A-12 · 오픈 데스크");
      expect(surface).toHaveTextContent("오후 13:00–22:00");
      expect(surface).toHaveTextContent("3명");
    }
  });
  it.each([
    ["operator", false, "운영자"],
    ["maintenance", true, "점검"],
    [null, true, "본인"],
    [null, false, "다른 사람"],
  ] as const)(
    "keeps cancellation precedence for %s / owner %s",
    (cancelKind, cancelledByOwner, label) => {
      render(
        provider(
          <AdminBookings
            data={adminBookingsFixture({
              rows: [
                adminBookingFixture({
                  status: "cancelled",
                  canCancel: false,
                  cancelKind,
                  cancelledByOwner,
                  cancelReason: cancelKind ? "냉방기 점검" : null,
                }),
              ],
            })}
          />,
        ),
      );
      expect(
        screen.getAllByText(`취소됨 · ${label}`, { exact: !cancelKind }),
      ).toHaveLength(2);
      if (cancelKind)
        expect(
          within(screen.getByRole("table")).getByText(`취소됨 · ${label}`),
        ).toHaveAttribute("title", "냉방기 점검");
    },
  );
  it("shows selected filter text in SSR and keeps every filter in pagination", () => {
    const data = adminBookingsFixture({
      total: 70,
      filters: {
        date: "2026-10-14",
        days: 7,
        floorId: adminBookingFloorId,
        type: "meeting_room",
        status: "all",
        q: "기획 회의",
        page: 2,
      },
    });
    const html = renderToString(provider(<AdminBookings data={data} />));
    const server = document.createElement("div");
    server.innerHTML = html;
    expect(
      within(server).getByRole("combobox", { name: "기간" }),
    ).toHaveTextContent("7일");
    expect(
      within(server).getByRole("combobox", { name: "층" }),
    ).toHaveTextContent("7F");
    expect(
      within(server).getByRole("combobox", { name: "종류" }),
    ).toHaveTextContent("회의실");
    expect(
      within(server).getByRole("combobox", { name: "상태" }),
    ).toHaveTextContent("모두");
    render(provider(<AdminBookings data={data} />));
    expect(screen.getByText("70건 가운데 31–60")).toBeVisible();
    for (const [label, page] of [
      ["이전", 1],
      ["다음", 3],
    ] as const)
      expect(screen.getByRole("link", { name: label })).toHaveAttribute(
        "href",
        adminBookingsHref(data.branch.id, { ...data.filters, page }),
      );
    expect(screen.getByRole("table")).toHaveTextContent("10/14 12:00–13:00");
  });
  it("submits filter URL values and resets pagination without a mutation", () => {
    const data = adminBookingsFixture({
      filters: {
        date: "2026-10-14",
        days: 7,
        floorId: adminBookingFloorId,
        type: "meeting_room",
        status: "all",
        q: "기획 회의",
        page: 2,
      },
    });
    render(provider(<AdminBookings data={data} />));
    fireEvent.change(screen.getByLabelText("날짜"), {
      target: { value: "2026-10-15" },
    });
    fireEvent.change(screen.getByLabelText("예약 검색"), {
      target: { value: "가상 팀" },
    });
    fireEvent.submit(
      screen.getByRole("button", { name: "찾기" }).closest("form")!,
    );
    const url = new URL(
      navigation.push.mock.calls[0]![0],
      "https://floor.test",
    );
    expect(url.pathname).toBe(`/admin/branches/${data.branch.id}/bookings`);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      date: "2026-10-15",
      days: "7",
      floor: adminBookingFloorId,
      type: "meeting_room",
      status: "all",
      q: "가상 팀",
    });
    expect(screen.getByLabelText("예약 검색")).toHaveAttribute(
      "minlength",
      "2",
    );
    expect(screen.getByLabelText("예약 검색")).toHaveAttribute(
      "maxlength",
      "40",
    );
    expect(cancelBookingAsOperator).not.toHaveBeenCalled();
  });
  it("shows the empty filter result only after data and offers no row action", () => {
    render(
      provider(
        <AdminBookings data={adminBookingsFixture({ rows: [], total: 0 })} />,
      ),
    );
    expect(screen.getByText("조건에 맞는 예약이 없어요")).toBeVisible();
    expect(screen.getByText("0건 가운데 0")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /예약 동작/ }),
    ).not.toBeInTheDocument();
  });
});

describe("operator cancellation dialog", () => {
  it("requires a preset, retains optional input and never submits invalid data", async () => {
    render(provider(<DialogFixture />));
    fireEvent.change(screen.getByLabelText("덧붙일 내용 (선택)"), {
      target: { value: "냉방기 점검" },
    });
    submitDialog();
    expect(screen.getByRole("combobox", { name: "취소 이유" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "입력한 내용을 확인해 주세요",
    );
    expect(screen.getByLabelText("덧붙일 내용 (선택)")).toHaveValue(
      "냉방기 점검",
    );
    expect(cancelBookingAsOperator).not.toHaveBeenCalled();
    await selectPreset();
    expect(
      screen.getByText(
        "예약자와 참석자 3명에게 '운영자가 예약을 취소했어요' 알림이 가요",
      ),
    ).toBeVisible();
    expect(
      screen.getByText("회의 채널에 취소 기록이 남고 읽기 전용이 돼요"),
    ).toBeVisible();
  });
  it.each(cancellationPresets)(
    "allows preset-only %s and keeps the action's single argument",
    async (preset) => {
      render(provider(<DialogFixture />));
      await selectPreset(preset);
      submitDialog();
      await waitFor(() =>
        expect(cancelBookingAsOperator).toHaveBeenCalledExactlyOnceWith({
          bookingId: adminBookingFixture().id,
          preset,
          text: "",
        }),
      );
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
    },
  );
  it("counts Unicode code points including the preset and separator", async () => {
    render(provider(<DialogFixture />));
    await selectPreset("운영 사정");
    const limit = 200 - (Array.from("운영 사정").length + 3);
    const field = screen.getByLabelText("덧붙일 내용 (선택)");
    fireEvent.change(field, { target: { value: "😀".repeat(limit + 1) } });
    submitDialog();
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText("이유는 합쳐서 200자 이내로 적어 주세요"),
    ).toBeVisible();
    expect(cancelBookingAsOperator).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: "😀".repeat(limit) } });
    submitDialog();
    await waitFor(() =>
      expect(cancelBookingAsOperator).toHaveBeenCalledExactlyOnceWith({
        bookingId: adminBookingFixture().id,
        preset: "운영 사정",
        text: "😀".repeat(limit),
      }),
    );
  });
  it("locks duplicate synchronous submissions and closing while pending", async () => {
    let finish!: (value: ActionResult<{ bookingId: string }>) => void;
    const pending = new Promise<ActionResult<{ bookingId: string }>>(
      (resolve) => {
        finish = resolve;
      },
    );
    vi.mocked(cancelBookingAsOperator).mockReturnValue(pending);
    render(provider(<DialogFixture />));
    await selectPreset();
    const form = screen
      .getByRole("button", { name: "예약 취소" })
      .closest("form")!;
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() =>
      expect(cancelBookingAsOperator).toHaveBeenCalledTimes(1),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "취소하는 중…" }),
      ).toBeDisabled(),
    );
    expect(screen.getByRole("button", { name: "돌아가기" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "취소 이유" })).toBeDisabled();
    expect(screen.getByLabelText("덧붙일 내용 (선택)")).toBeDisabled();
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("dialog")).toBeVisible();
    await act(async () =>
      finish({ ok: true, data: { bookingId: adminBookingFixture().id } }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(toast.success).toHaveBeenCalledExactlyOnceWith(
      "예약을 취소했어요. 예약자와 참석자에게 알렸어요",
    );
    expect(navigation.refresh).toHaveBeenCalledTimes(1);
  });
  it.each(["FORBIDDEN", "network", "not_cancellable"] as const)(
    "preserves the draft after %s failure and refreshes only stale booking state",
    async (failure) => {
      if (failure === "network")
        vi.mocked(cancelBookingAsOperator).mockRejectedValue(
          new Error("private transport detail"),
        );
      else
        vi.mocked(cancelBookingAsOperator).mockResolvedValue(
          failure === "not_cancellable"
            ? { ok: false, code: "INVALID_INPUT", message: "not_cancellable" }
            : { ok: false, code: "FORBIDDEN" },
        );
      render(provider(<DialogFixture />));
      await selectPreset();
      fireEvent.change(screen.getByLabelText("덧붙일 내용 (선택)"), {
        target: { value: "냉방기 점검" },
      });
      submitDialog();
      await waitFor(() =>
        expect(screen.getByRole("alert")).toHaveTextContent(
          failure === "not_cancellable"
            ? "이미 끝났거나 취소된 예약이에요. 다시 확인해 주세요"
            : failure === "FORBIDDEN"
              ? "이 작업을 할 권한이 없어요"
              : "저장하지 못했어요. 잠시 뒤 다시 시도해 주세요",
        ),
      );
      expect(screen.getByRole("dialog")).toBeVisible();
      expect(
        screen.getByRole("combobox", { name: "취소 이유" }),
      ).toHaveTextContent("운영 사정");
      expect(screen.getByLabelText("덧붙일 내용 (선택)")).toHaveValue(
        "냉방기 점검",
      );
      expect(screen.getByRole("button", { name: "예약 취소" })).toBeEnabled();
      expect(navigation.refresh).toHaveBeenCalledTimes(
        failure === "not_cancellable" ? 1 : 0,
      );
      expect(toast.success).not.toHaveBeenCalled();
      expect(document.body).not.toHaveTextContent("private transport detail");
    },
  );
  it("does not promise a meeting channel for a desk booking", () => {
    render(
      provider(
        <DialogFixture
          row={adminBookingFixture({ spaceType: "desk", participantCount: 0 })}
        />,
      ),
    );
    expect(
      screen.getByText(
        "예약자와 참석자 1명에게 '운영자가 예약을 취소했어요' 알림이 가요",
      ),
    ).toBeVisible();
    expect(screen.queryByText(/회의 채널/)).not.toBeInTheDocument();
  });
  it.each(["back", "success"] as const)(
    "returns focus to the original row trigger after %s",
    async (kind) => {
      render(provider(<AdminBookings data={adminBookingsFixture()} />));
      const trigger = within(screen.getByRole("table")).getByRole("button", {
        name: "회의실 C 예약 동작",
      });
      await userEvent.click(trigger);
      await userEvent.click(
        screen.getByRole("menuitem", { name: "예약 취소" }),
      );
      expect(
        screen.getByRole("dialog", { name: "예약을 취소할까요?" }),
      ).toContainElement(document.activeElement as HTMLElement);
      if (kind === "success") {
        await selectPreset();
        submitDialog();
      } else
        await userEvent.click(screen.getByRole("button", { name: "돌아가기" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      await waitFor(() => expect(trigger).toHaveFocus());
      expect(cancelBookingAsOperator).toHaveBeenCalledTimes(
        kind === "success" ? 1 : 0,
      );
    },
  );
  it("disables cancellation when the server says the row has ended", async () => {
    render(
      provider(
        <AdminBookings
          data={adminBookingsFixture({
            rows: [adminBookingFixture({ canCancel: false })],
          })}
        />,
      ),
    );
    await userEvent.click(
      within(screen.getByRole("table")).getByRole("button", {
        name: "회의실 C 예약 동작",
      }),
    );
    expect(screen.getByRole("menuitem", { name: "예약 취소" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await userEvent.keyboard("{Enter}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(cancelBookingAsOperator).not.toHaveBeenCalled();
  });
});
