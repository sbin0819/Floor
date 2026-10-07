// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/globals.css", "utf8");

describe("2차 디자인 토큰", () => {
  it("컨트롤과 카드의 모서리를 구분해요", () => {
    expect(css).toContain("--radius: 10px;");
    expect(css).toContain("--radius-xl: 14px;");
    expect(css).toContain("--radius-sm: 8px;");
  });

  it.each([
    ["booked", "#dcdad3"],
    ["booked-border", "#c6c4bc"],
    ["booked-foreground", "#4a4945"],
    ["booked-strong", "#8f8d86"],
  ])("%s를 색과 Tailwind 유틸리티에 연결해요", (name, value) => {
    expect(css).toContain(`--${name}: ${value};`);
    expect(css).toContain(`--color-${name}: var(--${name});`);
  });

  it("그림자는 공용 테마에서만 정의해요", () => {
    expect(css).toContain("--shadow-card: 0 1px 2px rgb(28 28 26 / 0.05);");
    expect(css).toMatch(
      /--shadow-pop:\s*0 10px 30px rgb\(28 28 26 \/ 0\.12\),\s*0 2px 6px rgb\(28 28 26 \/ 0\.06\);/,
    );
  });

  it("자체 호스팅 가변 글꼴이 굵기 700을 포함해요", () => {
    const fonts = readFileSync("lib/fonts.ts", "utf8");
    const range = fonts.match(/weight:\s*"(\d+) (\d+)"/);
    expect(range).not.toBeNull();
    expect(Number(range?.[1])).toBeLessThanOrEqual(700);
    expect(Number(range?.[2])).toBeGreaterThanOrEqual(700);
  });
});
