import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge, type Status } from "@/components/status-badge";

describe("StatusBadge", () => {
  it.each<[Status, string]>([
    ["free", "비어 있음"],
    ["busy", "사용 중"],
    ["mine", "내 예약"],
    ["maintenance", "점검 중"],
    ["restricted", "전용 공간"],
    ["pending", "수락 대기"],
  ])("%s에는 글자 라벨이 있어요", (status, text) => {
    render(<StatusBadge status={status} />);
    expect(screen.getByText(text)).toBeVisible();
    if (status === "restricted")
      expect(screen.getByText(text).querySelector("svg")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
  });
});
