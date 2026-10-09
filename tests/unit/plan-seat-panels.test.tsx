import { Activity, StrictMode, useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SeatArrayPanel } from "@/features/floor-plan/editor/seat-array-panel";
import { SeatProperties } from "@/features/floor-plan/editor/seat-properties";
import type { Command } from "@/features/floor-plan/editor/commands";
import type { PlanSeat } from "@/lib/floor-plan/types";
import {
  seatAreaId,
  seatDocument,
  seatRows,
  seatUuid,
} from "../helpers/plan-seat-array";

afterEach(() => vi.restoreAllMocks());
function arrayProps() {
  return {
    document: seatDocument(),
    areaId: seatAreaId,
    spaces: seatRows,
    onCommand: vi.fn<(command: Command) => void>(),
    onPreview: vi.fn<(seats: readonly PlanSeat[] | null) => void>(),
    onCancel: vi.fn(),
  };
}
describe("SeatArrayPanel", () => {
  it("opens 7F with actual inferred values and allocates no ids for preview/no-op", () => {
    const ids = vi.spyOn(crypto, "randomUUID");
    const props = arrayProps();
    render(<SeatArrayPanel {...props} />);
    expect(screen.getByLabelText("줄 수")).toHaveValue(4);
    expect(screen.getByLabelText("칸 수")).toHaveValue(6);
    expect(screen.getByLabelText("세로 간격 (mm)")).toHaveValue(1300);
    expect(screen.getByText("미리보기 24개 · 새 좌석 0개")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "배열 적용" }));
    expect(screen.getByText("변경된 좌석이 없어요")).toBeInTheDocument();
    expect(ids).not.toHaveBeenCalled();
    expect(props.onCommand).not.toHaveBeenCalled();
    expect(props.onPreview.mock.lastCall?.[0]?.[0]).toBe(
      props.document.seats[0],
    );
  });
  it("changes only preview then applies 5×6 once, with six new pairs of ids", () => {
    let id = 0;
    const uuid = vi
      .spyOn(crypto, "randomUUID")
      .mockImplementation(() => seatUuid(++id));
    const onCommand = vi.fn();
    function Harness() {
      const [document, setDocument] = useState(seatDocument);
      return (
        <SeatArrayPanel
          {...arrayProps()}
          document={document}
          onCommand={(command) => {
            onCommand(command);
            setDocument(command.apply(document));
          }}
        />
      );
    }
    render(<Harness />);
    fireEvent.change(screen.getByLabelText("줄 수"), {
      target: { value: "5" },
    });
    expect(
      screen.getByText("구역 밖으로 나가는 좌석이 6개 있어요"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "배열 적용" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("세로 간격 (mm)"), {
      target: { value: "1100" },
    });
    expect(screen.getByText("미리보기 30개 · 새 좌석 6개")).toBeInTheDocument();
    expect(uuid).not.toHaveBeenCalled();
    expect(onCommand).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "배열 적용" }));
    expect(uuid).toHaveBeenCalledTimes(12);
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(screen.getByText("미리보기 30개 · 새 좌석 0개")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "배열 적용" }));
    expect(uuid).toHaveBeenCalledTimes(12);
    expect(onCommand).toHaveBeenCalledTimes(1);
  });
  it("clears previews on disable, cancel and unmount, and disables invalid settings", () => {
    const props = arrayProps();
    const view = render(<SeatArrayPanel {...props} />);
    fireEvent.change(screen.getByLabelText("이름 앞글자"), {
      target: { value: "앞글자가너무길어요" },
    });
    expect(screen.getByRole("button", { name: "배열 적용" })).toBeDisabled();
    expect(
      screen.getByText("줄·칸, 좌석 크기, 간격과 이름을 확인해 주세요"),
    ).toBeInTheDocument();
    view.rerender(<SeatArrayPanel {...props} disabled />);
    expect(screen.getByLabelText("줄 수")).toBeDisabled();
    expect(props.onPreview.mock.lastCall).toEqual([null]);
    view.rerender(<SeatArrayPanel {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "취소" }));
    expect(props.onCancel).toHaveBeenCalledOnce();
    expect(props.onPreview.mock.lastCall).toEqual([null]);
    view.unmount();
    expect(props.onPreview.mock.lastCall).toEqual([null]);
    expect(props.onCommand).not.toHaveBeenCalled();
  });
  it("preserves settings while Activity hides and resumes, clearing hidden overlays", async () => {
    const props = arrayProps();
    const tree = (mode: "visible" | "hidden") => (
      <Activity mode={mode}>
        <SeatArrayPanel {...props} />
      </Activity>
    );
    const view = render(tree("visible"));
    fireEvent.change(screen.getByLabelText("줄 수"), {
      target: { value: "5" },
    });
    fireEvent.change(screen.getByLabelText("세로 간격 (mm)"), {
      target: { value: "1100" },
    });
    view.rerender(tree("hidden"));
    expect(props.onPreview.mock.lastCall).toEqual([null]);
    view.rerender(tree("visible"));
    await waitFor(() => expect(screen.getByLabelText("줄 수")).toHaveValue(5));
    expect(props.onPreview.mock.lastCall?.[0]).toHaveLength(30);
    expect(props.onCommand).not.toHaveBeenCalled();
  });
  it("does not create an effect feedback loop when callback and rows are rebuilt", () => {
    const document = seatDocument();
    let calls = 0;
    function Harness() {
      const [preview, setPreview] = useState<readonly PlanSeat[] | null>(null);
      return (
        <>
          <span>{preview?.length ?? 0}개 표시</span>
          <SeatArrayPanel
            document={document}
            areaId={seatAreaId}
            spaces={seatRows.map((row) => ({ ...row }))}
            onCommand={() => {}}
            onCancel={() => {}}
            onPreview={(value) => {
              if (++calls > 10) throw new Error("preview loop");
              setPreview(value);
            }}
          />
        </>
      );
    }
    render(
      <StrictMode>
        <Harness />
      </StrictMode>,
    );
    expect(screen.getByText("24개 표시")).toBeInTheDocument();
    expect(calls).toBeLessThan(6);
  });
  it("shows a safe no-selection message and preserves an irregular no-op", () => {
    const props = arrayProps();
    const view = render(<SeatArrayPanel {...props} areaId="missing" />);
    expect(
      screen.getByText("데스크 구역을 먼저 골라 주세요"),
    ).toBeInTheDocument();
    props.document.seats[0] = { ...props.document.seats[0]!, rotation: 90 };
    view.rerender(<SeatArrayPanel {...props} key="selected" />);
    expect(
      screen.getByText(/현재 좌석이 고른 배열이 아니에요/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "배열 적용" }));
    expect(props.onCommand).not.toHaveBeenCalled();
  });
});

describe("SeatProperties", () => {
  it("commits keyboard name/size edits and rotation, showing the server booking count", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    function Harness() {
      const [document, setDocument] = useState(seatDocument);
      return (
        <SeatProperties
          document={document}
          seatId={document.seats[0]!.id}
          displayName="A-01"
          bookingCount={2}
          onCommand={(command) => {
            onCommand(command);
            setDocument(command.apply(document));
          }}
        />
      );
    }
    render(<Harness />);
    expect(
      screen.getByText(
        "예약 2건이 남아 있어요. 이 좌석을 지우면 게시할 수 없어요.",
      ),
    ).toBeInTheDocument();
    const name = screen.getByLabelText("좌석 이름");
    await user.clear(name);
    await user.type(name, "  창가 좌석{Enter}");
    expect(name).toHaveValue("창가 좌석");
    expect(onCommand).toHaveBeenCalledTimes(1);
    const width = screen.getByLabelText("너비 (mm)");
    await user.clear(width);
    await user.type(width, "1200{Enter}");
    expect(width).toHaveValue(1200);
    expect(onCommand).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: "90°" }));
    expect(screen.getByRole("button", { name: "90°" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(onCommand).toHaveBeenCalledTimes(3);
  });
  it("links validation errors, keeps unknown names editable, and respects the write lock", async () => {
    const user = userEvent.setup();
    const document = seatDocument();
    const onCommand = vi.fn();
    delete document.seats[0]!.label;
    const props = {
      document,
      seatId: document.seats[0]!.id,
      displayName: null,
      onCommand,
    };
    const view = render(<SeatProperties {...props} />);
    const name = screen.getByLabelText("좌석 이름");
    expect(name).toHaveValue("");
    await user.type(name, `${"가".repeat(21)}{Enter}`);
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name).toHaveAccessibleDescription(
      "좌석 이름을 20자 이내로 입력해 주세요",
    );
    fireEvent.change(screen.getByLabelText("너비 (mm)"), {
      target: { value: "399" },
    });
    fireEvent.blur(screen.getByLabelText("너비 (mm)"));
    expect(screen.getByLabelText("너비 (mm)")).toHaveAccessibleDescription(
      "400–3,000mm로 입력해 주세요",
    );
    expect(onCommand).not.toHaveBeenCalled();
    view.rerender(<SeatProperties {...props} disabled />);
    expect(name).toBeDisabled();
    expect(screen.getByRole("button", { name: "180°" })).toBeDisabled();
    expect(screen.queryByText(/건이 남아 있어요/)).not.toBeInTheDocument();
  });
});
