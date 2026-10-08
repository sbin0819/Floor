import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { UserAvatar } from "@/components/user-avatar";
import { AVATAR_COLORS } from "@/lib/avatar";
import { StatusDot } from "@/features/people/components/person-status";

describe("UserAvatar", () => {
  it.each(AVATAR_COLORS)("uses the static %s token pair", (color) => {
    render(
      <UserAvatar
        name="김하은"
        avatar={{ color, photoUrl: null }}
        alt="김하은"
      />,
    );
    expect(screen.getByRole("img", { name: "김하은" })).toHaveClass(
      `bg-avatar-${color}`,
      `text-avatar-${color}-foreground`,
    );
    expect(screen.getByText("김")).toBeInTheDocument();
  });
  it("keeps a decorative avatar out of the accessibility tree", () => {
    render(
      <UserAvatar name="👩김" avatar={{ color: "blue", photoUrl: null }} />,
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("👩")).toHaveAttribute("aria-hidden", "true");
  });
  it("loads provider photos privately and falls back only for the failed URL", () => {
    const avatar = {
      color: "green" as const,
      photoUrl: "https://avatars.githubusercontent.com/u/1",
    };
    const { container, rerender } = render(
      <UserAvatar name="이서연" avatar={avatar} alt="이서연" />,
    );
    const photo = container.querySelector("img")!;
    expect(photo).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(photo).toHaveAttribute("loading", "lazy");
    expect(photo).toHaveAttribute("decoding", "async");
    expect(photo).toHaveAttribute("alt", "");
    fireEvent.error(photo);
    expect(container.querySelector("img")).toBeNull();
    expect(screen.getByRole("img", { name: "이서연" })).toHaveTextContent("이");
    rerender(
      <UserAvatar
        name="이서연"
        avatar={{
          ...avatar,
          photoUrl: "https://avatars.githubusercontent.com/u/2",
        }}
      />,
    );
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://avatars.githubusercontent.com/u/2",
    );
  });
  it.each([20, 24, 28, 30, 32, 34, 36, 40, 60, 64, 72] as const)(
    "supports fixed size %d",
    (size) => {
      const { container } = render(
        <UserAvatar
          name="박지훈"
          avatar={{ color: "purple", photoUrl: null }}
          size={size}
          status={<StatusDot status="dnd" />}
        />,
      );
      expect(container.querySelector("[data-user-avatar]")).not.toBeNull();
      expect(
        screen.getByRole("img", { name: "방해 금지" }),
      ).toBeInTheDocument();
    },
  );
});
