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
import { useState } from "react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BranchForm } from "@/features/admin/components/branch-form";
import { BranchDetail } from "@/features/admin/components/branch-detail";
import { AdminFloorList } from "@/features/admin/components/floor-list";
import {
  applyMondayToWeekdays,
  completeOpenHours,
  OpenHoursFields,
} from "@/features/admin/components/open-hours-fields";
import { updateBranch } from "@/features/admin/actions";
import type { ActionResult } from "@/lib/actions/result";
import type { OpenHours } from "@/lib/time/open-hours";
import { adminBranchFixture, adminIds } from "./admin-ui-fixtures";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => navigation }));
vi.mock("@/features/admin/actions", () => ({
  updateBranch: vi.fn(),
  createFloor: vi.fn(),
  updateFloor: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
beforeAll(() => {
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateBranch).mockResolvedValue({
    ok: true,
    data: { branchId: adminIds.branch },
  });
});
const weekdayNames = ["월요일", "화요일", "수요일", "목요일", "금요일"];
function branchDisplay(
  canManage = true,
  hours: OpenHours = {
    mon: { open: "08:00", close: "18:00" },
    sat: { open: "10:00", close: "14:00" },
    sun: null,
  },
) {
  const branch = { ...adminBranchFixture().branch, openHours: hours };
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <BranchForm branch={branch} canManage={canManage} />
    </QueryClientProvider>,
  );
}

describe("weekday operating-hours table", () => {
  it("uses one named row per day with a closed switch and accessible start/end selects", () => {
    branchDisplay();
    const table = screen.getByRole("table", { name: "요일별 운영 시간" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((cell) => cell.textContent),
    ).toEqual(["요일", "쉬는 날", "시작", "끝"]);
    expect(within(table).getAllByRole("row")).toHaveLength(8);
    for (const day of [...weekdayNames, "토요일", "일요일"]) {
      const row = within(table)
        .getByRole("rowheader", { name: day })
        .closest("tr")!;
      expect(
        within(row).getByRole("switch", { name: `${day} 쉬는 날` }),
      ).toBeInTheDocument();
      expect(
        within(row).getByRole("combobox", { name: `${day} 시작` }),
      ).toBeInTheDocument();
      expect(
        within(row).getByRole("combobox", { name: `${day} 끝` }),
      ).toBeInTheDocument();
    }
    expect(screen.getByLabelText("일요일 시작")).toBeDisabled();
    expect(screen.getByLabelText("일요일 끝")).toBeDisabled();
  });

  it("copies Monday to Tuesday–Friday only without saving, then submits all seven days once", async () => {
    branchDisplay();
    await userEvent.click(
      screen.getByRole("button", { name: "월요일 시간을 평일 전체에 적용" }),
    );
    expect(updateBranch).not.toHaveBeenCalled();
    for (const day of weekdayNames) {
      expect(screen.getByLabelText(`${day} 시작`)).toHaveTextContent("08:00");
      expect(screen.getByLabelText(`${day} 끝`)).toHaveTextContent("18:00");
    }
    expect(screen.getByLabelText("토요일 시작")).toHaveTextContent("10:00");
    expect(
      screen.getByRole("switch", { name: "일요일 쉬는 날" }),
    ).toBeChecked();
    await userEvent.click(
      screen.getByRole("button", { name: "지점 정보 저장" }),
    );
    await waitFor(() => expect(updateBranch).toHaveBeenCalledTimes(1));
    expect(updateBranch).toHaveBeenCalledWith({
      branchId: adminIds.branch,
      name: "가상 강남점",
      address: "가상 거리",
      openHours: {
        mon: { open: "08:00", close: "18:00" },
        tue: { open: "08:00", close: "18:00" },
        wed: { open: "08:00", close: "18:00" },
        thu: { open: "08:00", close: "18:00" },
        fri: { open: "08:00", close: "18:00" },
        sat: { open: "10:00", close: "14:00" },
        sun: null,
      },
    });
  });

  it("copies Monday's closed value, disables weekday time controls and preserves weekends", async () => {
    branchDisplay();
    await userEvent.click(
      screen.getByRole("switch", { name: "월요일 쉬는 날" }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: "월요일 시간을 평일 전체에 적용" }),
    );
    for (const day of weekdayNames) {
      expect(
        screen.getByRole("switch", { name: `${day} 쉬는 날` }),
      ).toBeChecked();
      expect(screen.getByLabelText(`${day} 시작`)).toBeDisabled();
      expect(screen.getByLabelText(`${day} 끝`)).toBeDisabled();
    }
    expect(
      screen.getByRole("switch", { name: "토요일 쉬는 날" }),
    ).not.toBeChecked();
    expect(updateBranch).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "지점 정보 저장" }),
    );
    await waitFor(() =>
      expect(updateBranch).toHaveBeenCalledWith(
        expect.objectContaining({
          openHours: {
            mon: null,
            tue: null,
            wed: null,
            thu: null,
            fri: null,
            sat: { open: "10:00", close: "14:00" },
            sun: null,
          },
        }),
      ),
    );
  });

  it("does not mutate the original hours or share mutable copied days", () => {
    const original = completeOpenHours({
      mon: { open: "08:00", close: "24:00" },
      sun: null,
    });
    const copy = applyMondayToWeekdays(original);
    expect(original.tue).toEqual({ open: "09:00", close: "22:00" });
    expect(copy.tue).not.toBe(original.mon);
    expect(copy.tue).not.toBe(copy.wed);
    expect(copy.tue).toEqual({ open: "08:00", close: "24:00" });
    expect(copy.sat).toEqual(original.sat);
    expect(copy.sun).toBeNull();
  });

  it("places validation errors below that day and retains the select's error description", async () => {
    branchDisplay();
    await userEvent.click(screen.getByLabelText("월요일 끝"));
    await userEvent.click(screen.getByRole("option", { name: "07:30" }));
    await userEvent.click(
      screen.getByRole("button", { name: "지점 정보 저장" }),
    );
    expect(updateBranch).not.toHaveBeenCalled();
    const select = screen.getByLabelText("월요일 끝");
    expect(select).toHaveAccessibleDescription(
      "종료 시각은 시작 시각보다 늦어야 해요",
    );
    const error = screen.getByText("종료 시각은 시작 시각보다 늦어야 해요");
    expect(select.closest("tr")?.nextElementSibling).toContainElement(error);
    expect(error.closest("td")).toHaveAttribute("colspan", "4");
  });

  it("leaves name/address editable, timezone read-only and saves information/hours together", async () => {
    branchDisplay();
    expect(
      screen.queryByRole("textbox", { name: /시간대/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/시간대: Asia\/Seoul/)).toBeVisible();
    await userEvent.clear(screen.getByLabelText("지점 이름"));
    await userEvent.type(screen.getByLabelText("지점 이름"), "가상 역삼점");
    await userEvent.clear(screen.getByLabelText("주소"));
    expect(
      screen.getAllByRole("button", { name: "지점 정보 저장" }),
    ).toHaveLength(1);
    await userEvent.click(
      screen.getByRole("button", { name: "지점 정보 저장" }),
    );
    await waitFor(() =>
      expect(updateBranch).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "가상 역삼점",
          address: "",
          openHours: expect.objectContaining({
            mon: { open: "08:00", close: "18:00" },
          }),
        }),
      ),
    );
  });

  it("keeps every field and weekday-copy read only without space.manage", () => {
    branchDisplay(false);
    expect(screen.getByLabelText("지점 이름")).toBeDisabled();
    expect(screen.getByLabelText("주소")).toBeDisabled();
    for (const role of ["switch", "combobox", "button"] as const)
      for (const control of screen.getAllByRole(role))
        expect(control).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "지점 설정" }));
    expect(updateBranch).not.toHaveBeenCalled();
  });

  it("disables the copy button while saving and blocks repeated writes", async () => {
    let finish!: (result: ActionResult<{ branchId: string }>) => void;
    vi.mocked(updateBranch).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    branchDisplay();
    const form = screen.getByRole("form", { name: "지점 설정" });
    act(() => {
      fireEvent.submit(form);
      fireEvent.submit(form);
    });
    await waitFor(() => expect(updateBranch).toHaveBeenCalledTimes(1));
    expect(
      screen.getByRole("button", { name: "월요일 시간을 평일 전체에 적용" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "저장하고 있어요" }),
    ).toBeDisabled();
    await act(async () =>
      finish({ ok: true, data: { branchId: adminIds.branch } }),
    );
    await waitFor(() => expect(navigation.refresh).toHaveBeenCalledTimes(1));
  });
});

describe("floor table", () => {
  it("connects the branch page breadcrumb, information, hours, and floor table without changing permissions", () => {
    const data = adminBranchFixture();
    data.permissions.manageSpaces = false;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <BranchDetail data={data} />
      </QueryClientProvider>,
    );
    const breadcrumb = screen.getByRole("navigation", { name: "경로" });
    expect(
      within(breadcrumb).getByRole("link", { current: "page" }),
    ).toHaveTextContent(data.branch.name);
    expect(screen.getByRole("heading", { name: "지점 정보" })).toBeVisible();
    expect(screen.getByRole("group", { name: "운영 시간" })).toBeVisible();
    expect(screen.getByRole("table", { name: "층 목록" })).toBeVisible();
    expect(screen.getByRole("button", { name: "층 더하기" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "7층 7F" })).toHaveAttribute(
      "href",
      `/admin/branches/${adminIds.branch}/floors/${adminIds.floor}`,
    );
  });
  it("uses real links in the first cell, badges and four columns", () => {
    const data = adminBranchFixture();
    data.floors.push({
      ...data.floors[0]!,
      id: "other",
      level: -1,
      name: "B1",
      access: "teams",
      spaceCount: 4,
    });
    render(<AdminFloorList branchId={data.branch.id} floors={data.floors} />);
    const table = screen.getByRole("table", { name: "층 목록" });
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((header) => header.textContent),
    ).toEqual(["층 번호", "이름", "이용 대상", "공간 수"]);
    const link = within(table).getByRole("link", { name: "7층 7F" });
    expect(link).toHaveAttribute(
      "href",
      `/admin/branches/${adminIds.branch}/floors/${adminIds.floor}`,
    );
    expect(link.parentElement?.tagName).toBe("TH");
    expect(link.parentElement?.parentElement?.tagName).toBe("TR");
    expect(link).toHaveClass(
      "after:absolute",
      "after:inset-0",
      "focus-visible:after:ring-2",
    );
    expect(table.querySelector("a tr")).toBeNull();
    expect(table.querySelector("tr[onclick]")).toBeNull();
    expect(screen.getByText("지정한 팀")).toHaveAttribute("data-slot", "badge");
    expect(screen.getByText("4곳")).toHaveClass("tabular-nums");
  });
  it("keeps the empty-floor guidance", () => {
    render(<AdminFloorList branchId={adminIds.branch} floors={[]} />);
    expect(
      screen.getByText("층이 아직 없어요. 층을 더해 주세요"),
    ).toBeVisible();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

it("updates only controlled state when operating hours are used without a form", async () => {
  const onChange = vi.fn();
  function Example() {
    const [value, setValue] = useState(() => completeOpenHours({ mon: null }));
    return (
      <OpenHoursFields
        value={value}
        disabled={false}
        errors={{}}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
      />
    );
  }
  render(<Example />);
  await userEvent.click(
    screen.getByRole("button", { name: "월요일 시간을 평일 전체에 적용" }),
  );
  expect(onChange).toHaveBeenCalledOnce();
  expect(updateBranch).not.toHaveBeenCalled();
});
