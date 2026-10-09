import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { VertexProperties } from "@/features/floor-plan/editor/vertex-properties";
import { editorDocument } from "../helpers/plan-editor-store";
afterEach(cleanup);
it("commits an accessible coordinate field only on blur", () => {
  const document = editorDocument(),
    onCommand = vi.fn();
  render(
    <VertexProperties document={document} shapeId="a" onCommand={onCommand} />,
  );
  fireEvent.click(screen.getByText("꼭짓점 4개"));
  const input = screen.getByLabelText("점 1 X (mm)");
  fireEvent.change(input, { target: { value: "1200" } });
  expect(onCommand).not.toHaveBeenCalled();
  fireEvent.blur(input);
  expect(
    onCommand.mock.calls[0]![0].apply(document).spaces[0].polygon[0],
  ).toEqual([1200, 1000]);
});
it("offers an edge midpoint with no minimum-wall deletion", () => {
  const document = editorDocument(),
    onCommand = vi.fn();
  render(
    <VertexProperties
      document={document}
      shapeId="wall"
      onCommand={onCommand}
    />,
  );
  fireEvent.click(screen.getByText("꼭짓점 2개"));
  expect(screen.getByRole("button", { name: "점 1 삭제" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "다음 변에 점 추가" }));
  expect(onCommand.mock.calls[0]![0].apply(document).walls[0].points).toEqual([
    [0, 0],
    [15000, 0],
    [30000, 0],
  ]);
});
it("disables all vertex controls while saving a publication", () => {
  render(
    <VertexProperties
      document={editorDocument()}
      shapeId="a"
      onCommand={vi.fn()}
      disabled
    />,
  );
  fireEvent.click(screen.getByText("꼭짓점 4개"));
  for (const field of screen.getAllByRole("spinbutton"))
    expect(field).toBeDisabled();
  for (const button of screen.getAllByRole("button"))
    expect(button).toBeDisabled();
});
