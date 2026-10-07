import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import Home from "@/app/page";

it("shows the setup shell and all six named statuses", () => {
  render(<Home />);
  expect(
    screen.getByRole("heading", { name: "Floor", level: 1 }),
  ).toBeVisible();
  expect(screen.getByRole("list", { name: "공간과 초대 상태" })).toBeVisible();
  expect(screen.getAllByRole("listitem")).toHaveLength(6);
});
