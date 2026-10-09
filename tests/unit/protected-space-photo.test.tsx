import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { SpacePhoto } from "@/components/photos/space-photo";

it("bypasses shared image optimization only for protected API pictures while retaining alt and loading behavior", () => {
  const path = "/api/space-photos/10000000-0000-4000-8000-000000000001.webp";
  const { rerender } = render(
    <SpacePhoto photo={{ path, alt: "회의실 창가" }} type="meeting_room" />,
  );
  const protectedImage = screen.getByRole("img", { name: "회의실 창가" });
  expect(
    new URL(protectedImage.getAttribute("src")!, window.location.href).pathname,
  ).toBe(path);
  expect(protectedImage).not.toHaveAttribute("srcset");
  expect(protectedImage).toHaveAttribute("loading", "lazy");
  rerender(
    <SpacePhoto
      photo={{
        path: "/seed/photos/meeting-small-sage.webp",
        alt: "시드 회의실",
      }}
      type="meeting_room"
    />,
  );
  const seedImage = screen.getByRole("img", { name: "시드 회의실" });
  expect(seedImage.getAttribute("src")).toContain("/_next/image?");
  expect(seedImage).toHaveAttribute("srcset");
});
it("does not issue a protected-image request for a restricted placeholder", () => {
  const { container } = render(
    <SpacePhoto
      photo={{
        path: "/api/space-photos/10000000-0000-4000-8000-000000000001.webp",
        alt: "숨긴 사진",
      }}
      type="meeting_room"
      restricted
    />,
  );
  expect(container.querySelector("img")).toBeNull();
  expect(container.innerHTML).not.toContain("/api/space-photos/");
  expect(screen.getByRole("img", { name: "전용 공간" })).toBeInTheDocument();
});
