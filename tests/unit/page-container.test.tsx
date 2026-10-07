import { render, screen } from "@testing-library/react";
import Link from "next/link";
import { describe, expect, it } from "vitest";
import { PageContainer, PageHeading } from "@/components/page-container";

describe("shared page frame", () => {
  it.each([
    ["wide", "max-w-[1184px]"],
    ["standard", "max-w-[880px]"],
    ["form", "max-w-[640px]"],
  ] as const)(
    "applies the %s width without replacing the page content",
    (width, className) => {
      render(
        <PageContainer as="main" width={width}>
          <p>기존 내용</p>
        </PageContainer>,
      );
      expect(screen.getByRole("main")).toHaveClass(
        className,
        "px-4",
        "md:px-8",
      );
      expect(screen.getByText("기존 내용")).toBeVisible();
    },
  );

  it("renders a page title, optional description and primary action", () => {
    render(
      <PageHeading
        title="내 예약"
        description="다가오는 예약을 확인해 주세요"
        action={<Link href="/branches">공간 예약하기</Link>}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "내 예약" }),
    ).toHaveClass("text-[26px]", "font-bold", "tracking-[-0.025em]");
    expect(screen.getByText("다가오는 예약을 확인해 주세요")).toHaveClass(
      "text-muted-foreground",
    );
    expect(screen.getByRole("link", { name: "공간 예약하기" })).toHaveAttribute(
      "href",
      "/branches",
    );
  });
});
