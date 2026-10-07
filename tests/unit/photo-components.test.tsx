import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PhotoGallery } from "@/components/photos/photo-gallery";
import { photoIndexAtOffset } from "@/components/photos/photo-position";
import { samplePhotos } from "@/components/photos/photo-fixtures";
import {
  SpacePhoto,
  type PhotoSpaceType,
} from "@/components/photos/space-photo";

function emulateScroll(container: HTMLElement) {
  const viewport = container.querySelector<HTMLElement>(
    '[data-slot="photo-viewport"]',
  );
  if (!viewport) throw new Error("Photo viewport was not rendered.");
  Object.defineProperty(viewport, "clientWidth", { value: 400 });
  const scrollTo = vi.fn((options: ScrollToOptions) => {
    viewport.scrollLeft = options.left ?? 0;
    fireEvent.scroll(viewport);
  });
  Object.defineProperty(viewport, "scrollTo", { value: scrollTo });
  return { viewport, scrollTo };
}

describe("SpacePhoto", () => {
  it("reserves the same size while loading, loaded, and failed", async () => {
    const { container } = render(
      <SpacePhoto
        photo={samplePhotos[0]!}
        type="meeting_room"
        size={{ width: 72, height: 54 }}
      />,
    );
    const frame = container.querySelector('[data-slot="space-photo"]');
    expect(frame).toHaveStyle({ width: "72px", height: "54px" });
    expect(screen.getByRole("status")).toHaveTextContent(
      "사진을 불러오고 있어요",
    );
    expect(container.querySelector('[aria-busy="true"]')).toBeInTheDocument();
    const image = screen.getByRole("img", { name: samplePhotos[0]!.alt });
    expect(image).toHaveAttribute("sizes", "72px");
    expect(image).toHaveAttribute("loading", "lazy");
    // jsdom은 Tailwind 레이아웃을 계산하지 않으므로 실제 렌더 크기를 제공한다.
    if (image.parentElement) image.parentElement.style.position = "relative";
    Object.defineProperty(image, "height", { value: 54 });
    fireEvent.load(image);
    await waitFor(() =>
      expect(screen.queryByRole("status")).not.toBeInTheDocument(),
    );
    expect(
      container.querySelector('[aria-busy="true"]'),
    ).not.toBeInTheDocument();
    fireEvent.error(image);
    expect(
      screen.getByRole("img", { name: "회의실 사진이 없어요" }),
    ).toBeVisible();
    expect(frame).toHaveStyle({ width: "72px", height: "54px" });
  });

  it.each<[PhotoSpaceType, string]>([
    ["meeting_room", "회의실"],
    ["seminar", "세미나실"],
    ["phone_booth", "폰부스"],
    ["desk_area", "데스크 구역"],
    ["desk", "좌석"],
    ["lounge", "라운지"],
    ["branch", "지점"],
  ])("uses the %s placeholder without an image request", (type, label) => {
    const { container } = render(<SpacePhoto photo={null} type={type} />);
    expect(
      screen.getByRole("img", { name: `${label} 사진이 없어요` }),
    ).toBeVisible();
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.querySelector("svg")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("never renders a supplied photo for a restricted space", () => {
    const { container } = render(
      <SpacePhoto photo={samplePhotos[0]!} type="meeting_room" restricted />,
    );
    expect(screen.getByRole("img", { name: "전용 공간" })).toHaveClass(
      "bg-status-maintenance-hatch",
    );
    expect(container.querySelector("img")).not.toBeInTheDocument();
    expect(container.innerHTML).not.toContain(samplePhotos[0]!.path);
  });

  it("uses empty alt and hides redundant placeholder and loading text when decorative", () => {
    const { container, rerender } = render(
      <SpacePhoto photo={samplePhotos[0]!} type="meeting_room" decorative />,
    );
    expect(container.querySelector("img")).toHaveAttribute("alt", "");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    rerender(<SpacePhoto photo={null} type="meeting_room" decorative />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("resets loading after changing the photo path and supports eager loading", () => {
    const { rerender } = render(
      <SpacePhoto photo={samplePhotos[0]!} type="meeting_room" eager />,
    );
    const first = screen.getByRole("img", { name: samplePhotos[0]!.alt });
    expect(first).toHaveAttribute("loading", "eager");
    expect(first).toHaveAttribute("fetchpriority", "high");
    fireEvent.error(first);
    rerender(<SpacePhoto photo={samplePhotos[1]!} type="meeting_room" />);
    expect(
      screen.getByRole("img", { name: samplePhotos[1]!.alt }),
    ).toBeVisible();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("photo position", () => {
  it.each([
    [0, 400, 3, 0],
    [199, 400, 3, 0],
    [201, 400, 3, 1],
    [400, 400, 3, 1],
    [790, 400, 3, 2],
    [2000, 400, 3, 2],
    [-100, 400, 3, 0],
    [400, 0, 3, 0],
    [0, 400, 0, 0],
    [Number.NaN, 400, 3, 0],
  ])(
    "offset %s at width %s and count %s becomes %s",
    (offset, width, count, index) => {
      expect(photoIndexAtOffset(offset, width, count)).toBe(index);
    },
  );
});

describe("PhotoGallery", () => {
  it("renders an accessible placeholder for zero photos", () => {
    render(<PhotoGallery photos={[]} name="리뷰룸" type="meeting_room" />);
    expect(screen.getByRole("group", { name: "리뷰룸 사진" })).toHaveAttribute(
      "aria-roledescription",
      "캐러셀",
    );
    expect(
      screen.getByRole("img", { name: "회의실 사진이 없어요" }),
    ).toBeVisible();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not show navigation, dots, or a count for one photo", () => {
    const { container } = render(
      <PhotoGallery photos={samplePhotos.slice(0, 1)} name="회의실 B" />,
    );
    expect(
      screen.getByRole("button", { name: "사진 크게 보기" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "다음 사진" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "이전 사진" }),
    ).not.toBeInTheDocument();
    expect(
      container.querySelector('[data-slot="photo-dots"]'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("1 / 1")).not.toBeInTheDocument();
  });

  it("moves through actual scroll events and disables the appropriate end button", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <PhotoGallery photos={samplePhotos} name="회의실 B" />,
    );
    const { scrollTo } = emulateScroll(container);
    const previous = screen.getByRole("button", { name: "이전 사진" });
    const next = screen.getByRole("button", { name: "다음 사진" });
    expect(previous).toBeDisabled();
    expect(screen.getByText("1 / 3")).toHaveAttribute("aria-live", "polite");
    await user.click(next);
    expect(scrollTo).toHaveBeenCalledWith({ left: 400, behavior: "auto" });
    expect(screen.getByText("2 / 3")).toBeVisible();
    expect(previous).toBeEnabled();
    expect(screen.getByRole("group", { name: "3장 중 2번째" })).toHaveAttribute(
      "aria-roledescription",
      "슬라이드",
    );
    await user.click(next);
    expect(screen.getByText("3 / 3")).toBeVisible();
    expect(next).toBeDisabled();
    await user.click(previous);
    expect(screen.getByText("2 / 3")).toBeVisible();
    expect(container.querySelector('[data-slot="photo-dots"]')).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });

  it("updates the index after swiping and honors reduced motion in CSS", () => {
    const { container } = render(
      <PhotoGallery photos={samplePhotos} name="회의실 B" />,
    );
    const { viewport } = emulateScroll(container);
    expect(viewport).toHaveClass(
      "snap-x",
      "snap-mandatory",
      "motion-reduce:scroll-auto",
    );
    viewport.scrollLeft = 800;
    fireEvent.scroll(viewport);
    expect(screen.getByText("3 / 3")).toBeVisible();
    expect(screen.getByRole("button", { name: "다음 사진" })).toBeDisabled();
  });

  it("uses arrows inside the gallery and retains focus on the visible photo", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <PhotoGallery photos={samplePhotos} name="회의실 B" />,
    );
    emulateScroll(container);
    screen.getByRole("button", { name: "사진 크게 보기" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByText("2 / 3")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "사진 크게 보기" }),
    ).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("1 / 3")).toBeVisible();
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByText("1 / 3")).toBeVisible();
  });

  it("loads only the first photo eagerly when requested", () => {
    const { container } = render(
      <PhotoGallery
        photos={samplePhotos}
        name="회의실 B"
        eager
        sizes="420px"
      />,
    );
    const images = [...container.querySelectorAll("img")];
    expect(images).toHaveLength(3);
    expect(images.map((image) => image.getAttribute("loading"))).toEqual([
      "eager",
      "lazy",
      "lazy",
    ]);
    expect(images.map((image) => image.getAttribute("fetchpriority"))).toEqual([
      "high",
      null,
      null,
    ]);
    for (const image of images) expect(image).toHaveAttribute("sizes", "420px");
  });

  it("opens the selected photo in a dialog with no nested enlarge buttons and restores focus", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <PhotoGallery photos={samplePhotos} name="회의실 B" />,
    );
    emulateScroll(container);
    await user.click(screen.getByRole("button", { name: "다음 사진" }));
    const trigger = screen.getByRole("button", { name: "사진 크게 보기" });
    await user.click(trigger);
    const dialog = screen.getByRole("dialog", { name: "회의실 B" });
    expect(within(dialog).getByText("2 / 3")).toBeVisible();
    expect(
      within(dialog).getByRole("group", { name: "3장 중 2번째" }),
    ).toBeVisible();
    expect(
      within(dialog).queryByRole("button", { name: "사진 크게 보기" }),
    ).not.toBeInTheDocument();
    expect(
      within(dialog).getByRole("img", { name: samplePhotos[1]!.alt }),
    ).toHaveClass("object-contain");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("resets gallery position when switching to a different space's photos", async () => {
    const user = userEvent.setup();
    const { container, rerender } = render(
      <PhotoGallery photos={samplePhotos} name="회의실 B" />,
    );
    emulateScroll(container);
    await user.click(screen.getByRole("button", { name: "다음 사진" }));
    rerender(
      <PhotoGallery photos={[...samplePhotos].reverse()} name="회의실 C" />,
    );
    expect(screen.getByText("1 / 3")).toBeVisible();
    expect(screen.getByRole("group", { name: "회의실 C 사진" })).toBeVisible();
  });
});
