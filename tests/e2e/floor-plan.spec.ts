import { expect, test } from "@playwright/test";

// 실제 인증·DB 흐름은 PGlite에서 검사하고, 이 파일은 동일 Canvas의 실제 브라우저 그림/입력을 검사한다.
const story =
  "http://127.0.0.1:6106/iframe.html?id=floorplan--normal&viewMode=story";
test.use({ viewport: { width: 1440, height: 900 } });
test("비로그인 평면도 요청은 캐시하지 않고 401로 거절해요", async ({
  request,
}) => {
  const response = await request.get(
    "/api/floor-plans/11111111-1111-4111-8111-111111111111",
  );
  expect(response.status()).toBe(401);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  expect(await response.json()).toEqual({ code: "UNAUTHENTICATED" });
});
test("7층 평면도의 라이트·다크 그림, 확대·끌기·맞춤", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(story);
  const canvas = page.locator("[data-plan-canvas]");
  await expect(canvas).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await expect(
    page.getByRole("slider", { name: "평면도 기준 시각" }),
  ).toHaveAttribute("aria-valuetext", "11시 30분");
  await expect(page).toHaveScreenshot("gangnam-7f-light.png", {
    animations: "disabled",
  });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await expect(page).toHaveScreenshot("gangnam-7f-dark.png", {
    animations: "disabled",
  });
  await page.getByRole("button", { name: "평면도 확대" }).click();
  await expect(page.getByLabel("평면도 배율")).toHaveText("125%");
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + 200, bounds.y + 200);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 270, bounds.y + 250, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "맞춤", exact: true }).click();
  await expect(page.getByLabel("평면도 배율")).toHaveText("100%");
  await expect(page).toHaveScreenshot("gangnam-7f-dark.png", {
    animations: "disabled",
  });
  expect(errors).toEqual([]);
});

test("평면도 방향키로 회의실 B를 골라 상세를 열어요", async ({ page }) => {
  await page.goto(story);
  const first = page.getByRole("button", { name: /^회의실 A,/ });
  await expect(first).toHaveAttribute("tabindex", "0");
  await first.focus();
  await page.keyboard.press("ArrowRight");
  const room = page.getByRole("button", { name: /^회의실 B,/ });
  await expect(room).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "회의실 B 상세" }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("space")).toBe(
    "bf9a611a-92eb-5825-9188-5ef9b191ca91",
  );
});
