import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WallProperties } from "@/features/floor-plan/editor/wall-properties";
import type { Command } from "@/features/floor-plan/editor/commands";
import { editorDocument } from "../helpers/plan-editor-store";

afterEach(cleanup);
function setup(kind: "wall" | "opening", disabled = false) {
  const initial = editorDocument();
  initial.openings = [
    { id: "door", wallId: "wall", at: 0.5, width: 900, kind: "door" },
  ];
  const changes = vi.fn<(command: Command | null) => void>();
  function Harness() {
    const [document, setDocument] = useState(initial);
    return (
      <WallProperties
        document={document}
        shapeId={kind === "wall" ? "wall" : "door"}
        disabled={disabled}
        onCommand={(command) => {
          changes(command);
          if (command) setDocument(command.apply(document));
        }}
      />
    );
  }
  render(<Harness />);
  return { changes, initial };
}
describe("wall properties", () => {
  it("commits wall thickness on blur, without changing the door", () => {
    const { changes, initial } = setup("wall");
    const input = screen.getByLabelText("벽 두께 (mm)");
    fireEvent.change(input, { target: { value: "200" } });
    expect(changes).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(changes.mock.calls[0]![0]!.apply(initial).openings).toEqual(
      initial.openings,
    );
    expect(input).toHaveValue(200);
  });
  it.each([49, 501])("rejects a wall thickness outside 50–500: %s", (value) => {
    const { changes } = setup("wall");
    const input = screen.getByLabelText("벽 두께 (mm)");
    fireEvent.change(input, { target: { value: String(value) } });
    fireEvent.blur(input);
    expect(changes).toHaveBeenCalledWith(null);
    expect(input).toHaveValue(100);
  });
  it("shows the door kind before opening the Select and commits width with Enter", () => {
    const { changes } = setup("opening");
    expect(screen.getByRole("combobox", { name: "문 종류" })).toHaveTextContent(
      "문",
    );
    const input = screen.getByLabelText("문 폭 (mm)");
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "1200" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(changes).toHaveBeenCalledTimes(1);
    expect(input).toHaveValue(1200);
  });
  it.each([299, 3001])("rejects a width outside 300–3000: %s", (value) => {
    const { changes } = setup("opening");
    const input = screen.getByLabelText("문 폭 (mm)");
    fireEvent.change(input, { target: { value: String(value) } });
    fireEvent.blur(input);
    expect(changes).toHaveBeenCalledWith(null);
    expect(input).toHaveValue(900);
  });
  it("locks the wall and opening controls", () => {
    setup("opening", true);
    expect(screen.getByLabelText("문 폭 (mm)")).toBeDisabled();
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});
