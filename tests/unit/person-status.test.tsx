import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StatusDot } from "@/features/people/components/person-status";

vi.mock("@/components/realtime-provider", () => ({
  usePresenceStatus: () => "unknown",
}));

describe("status symbols beyond color", () => {
  it.each([
    ["online", "온라인", "text-presence-online"],
    ["away", "자리 비움", "text-presence-away"],
    ["dnd", "방해 금지", "text-presence-dnd"],
    ["offline", "오프라인", "text-presence-offline"],
  ] as const)(
    "gives %s one accessible name and the specified token",
    (status, name, token) => {
      const { container } = render(<StatusDot status={status} />);
      const icon = screen.getByRole("img", { name });
      expect(icon).toHaveAttribute("focusable", "false");
      expect(icon).toHaveClass(token);
      expect(container.querySelectorAll('[role="img"]')).toHaveLength(1);
      expect(container.querySelector("button")).not.toBeInTheDocument();
    },
  );
  it("uses distinct filled, crescent, barred and hollow geometry without relying on color", () => {
    render(
      <>
        {(["online", "away", "dnd", "offline"] as const).map((status) => (
          <StatusDot key={status} status={status} />
        ))}
      </>,
    );
    expect(
      screen.getByRole("img", { name: "온라인" }).querySelector("circle"),
    ).toHaveAttribute("fill", "currentColor");
    const crescent = screen
      .getByRole("img", { name: "자리 비움" })
      .querySelector("path");
    const barred = screen
      .getByRole("img", { name: "방해 금지" })
      .querySelector("path");
    expect(crescent).toHaveAttribute(
      "d",
      "M10.6 7.2A5 5 0 0 1 4.8 1.4a5 5 0 1 0 5.8 5.8Z",
    );
    expect(barred).toHaveAttribute("fill-rule", "evenodd");
    expect(barred?.getAttribute("d")).toContain("M3 5h6v2H3Z");
    const hollow = screen
      .getByRole("img", { name: "오프라인" })
      .querySelector("circle");
    expect(hollow).toHaveAttribute("fill", "none");
    expect(hollow).toHaveAttribute("stroke", "currentColor");
  });
  it("does not imply a known status before presence has synchronized", () => {
    const { container } = render(<StatusDot status="unknown" />);
    expect(container).toBeEmptyDOMElement();
  });
});
