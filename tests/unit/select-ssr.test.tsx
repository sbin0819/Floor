import { useState, type ReactNode } from "react";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { ChoiceSelect } from "@/features/admin/components/form-fields";
import {
  completeOpenHours,
  OpenHoursFields,
} from "@/features/admin/components/open-hours-fields";
import { SpaceForm } from "@/features/admin/components/space-form";
import { BookingForm } from "@/features/bookings/components/booking-form";
import { BranchSelect } from "@/features/teams/components/team-fields";
import { spaceDayFixture } from "./booking-ui-fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/features/admin/actions", () => ({
  createSpace: vi.fn(),
  updateSpace: vi.fn(),
}));
vi.mock("@/features/bookings/actions", () => ({
  createBooking: vi.fn(),
  cancelBooking: vi.fn(),
}));
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});
function serverHtml(children: ReactNode) {
  const element = document.createElement("div");
  element.innerHTML = renderToString(
    <QueryClientProvider client={new QueryClient()}>
      {children}
    </QueryClientProvider>,
  );
  return within(element);
}
const options = [
  { value: "08:00", label: "08:00" },
  { value: "22:00", label: "22:00" },
];

describe("selected text before hydration", () => {
  it("includes all fourteen opening/closing labels in server-rendered triggers", () => {
    const hours = completeOpenHours({});
    for (const day of Object.keys(hours) as (keyof typeof hours)[])
      hours[day] = { open: "08:00", close: "22:00" };
    const html = serverHtml(
      <OpenHoursFields
        value={hours}
        onChange={vi.fn()}
        disabled={false}
        errors={{}}
      />,
    );
    expect(html.getAllByRole("combobox")).toHaveLength(14);
    expect(
      html.getAllByRole("combobox").map((item) => item.textContent),
    ).toEqual(Array.from({ length: 7 }, () => ["08:00", "22:00"]).flat());
  });
  it("renders the space type without relying on portalled option text", () => {
    const html = serverHtml(<SpaceForm floorId="floor" canManage />);
    expect(html.getByRole("combobox", { name: "종류" })).toHaveTextContent(
      "회의실",
    );
  });
  it("renders a team branch label and an empty branch placeholder on the server", () => {
    const props = {
      branches: [{ id: "branch", name: "가상 지점" }],
      onValueChange: vi.fn(),
      disabled: false,
    };
    expect(
      serverHtml(<BranchSelect {...props} value="branch" />).getByRole(
        "combobox",
      ),
    ).toHaveTextContent("가상 지점");
    expect(
      serverHtml(<BranchSelect {...props} value="" />).getByRole("combobox"),
    ).toHaveTextContent("지점을 선택해 주세요");
  });
  it("renders the current booking actor and empty time placeholders in the visible strip inputs on the server", () => {
    const data = spaceDayFixture();
    data.hasTeams = true;
    const html = serverHtml(<BookingForm data={data} variant="strip" />);
    expect(html.getByRole("combobox", { name: "예약 방식" })).toHaveTextContent(
      "개인으로",
    );
    expect(html.getByRole("combobox", { name: "시작" })).toHaveTextContent(
      "시작 시각 선택",
    );
    expect(html.getByRole("combobox", { name: "끝" })).toHaveTextContent(
      "끝 시각 선택",
    );
  });
  it("keeps unselected panel inputs collapsed on the server", () => {
    const html = serverHtml(<BookingForm data={spaceDayFixture()} />);
    expect(html.getByText("시간을 골라 주세요")).toHaveTextContent(
      "시간을 골라 주세요",
    );
    expect(html.queryByRole("combobox")).toBeNull();
    expect(html.queryByRole("button", { name: "예약하기" })).toBeNull();
  });
  it("uses the placeholder when a controlled selection is empty", () => {
    expect(
      serverHtml(
        <ChoiceSelect
          id="empty"
          value=""
          onChange={vi.fn()}
          options={options}
          placeholder="시각 선택"
        />,
      ).getByRole("combobox"),
    ).toHaveTextContent("시각 선택");
  });
  it("updates the visible label after a keyboard choice", async () => {
    function Controlled() {
      const [value, setValue] = useState("08:00");
      return (
        <ChoiceSelect
          id="time"
          value={value}
          onChange={setValue}
          options={options}
        />
      );
    }
    render(<Controlled />);
    const trigger = screen.getByRole("combobox");
    expect(trigger).toHaveTextContent("08:00");
    trigger.focus();
    await userEvent.keyboard("{Enter}{End}{Enter}");
    expect(trigger).toHaveTextContent("22:00");
    expect(trigger).not.toHaveTextContent("08:00");
  });
});
